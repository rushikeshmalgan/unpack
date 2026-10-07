import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { NormalizedContent } from "@/lib/content/types";
import { analysisResultSchema } from "@/lib/schemas/analysisResult";
import { explainResultSchema } from "@/lib/schemas/explainResult";
import { stepsResultSchema } from "@/lib/schemas/stepsResult";
import { toGeminiJsonSchema } from "@/lib/ai/jsonSchema";
import {
  SYSTEM_PROMPT,
  EXPLAIN_SYSTEM_PROMPT,
  STEPS_SYSTEM_PROMPT,
  buildUserPrompt,
  buildExplainPrompt,
  buildStepsPrompt,
} from "@/lib/ai/prompt";
import { classifyGeminiError, isImmediatelyRetryable } from "@/lib/ai/geminiErrorClassifier";
import { providerError, type AIProviderError } from "@/lib/ai/providerError";
import type { AIOutcome, AIAnalysisOutcome, AIProvider, ExplainInput, StepsInput } from "@/lib/ai/types";

// Flash-Lite: verified via a live generateContent call against our exact
// schema/prompt/parsing path (correct structured output, correct CTA/reward
// extraction, ~3s) before switching the default — see the model-check report
// for details. Override via GEMINI_MODEL if you need a different model.
const DEFAULT_MODEL = "gemini-flash-lite-latest";

function getModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

// Each individual network attempt gets this long; the whole operation makes
// at most one retry (see RetryBudget below), so worst case is roughly
// 2x this for the initial prompt, or +1x more if a schema-repair pass is
// also needed and the retry budget is still available for it.
const PER_ATTEMPT_TIMEOUT_MS = 15_000;

const ANALYSIS_SCHEMA = toGeminiJsonSchema(analysisResultSchema);
const EXPLAIN_SCHEMA = toGeminiJsonSchema(explainResultSchema);
const STEPS_SCHEMA = toGeminiJsonSchema(stepsResultSchema);

function safeJsonParse(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptOnce(
  client: GoogleGenAI,
  systemInstruction: string,
  responseJsonSchema: unknown,
  promptText: string,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
  try {
    const response = await client.models.generateContent({
      model: getModelName(),
      contents: promptText,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0.3,
        abortSignal: controller.signal,
      },
    });
    return response.text;
  } finally {
    clearTimeout(timer);
  }
}

// At most one retry across the *entire* generateStructured call (initial
// prompt + schema-repair prompt combined), shared via this mutable flag —
// deliberately conservative to bound both latency and AI cost per request.
interface RetryBudget {
  used: boolean;
}

async function callWithBoundedRetry(
  client: GoogleGenAI,
  systemInstruction: string,
  responseJsonSchema: unknown,
  promptText: string,
  budget: RetryBudget,
): Promise<{ text?: string; error?: AIProviderError }> {
  try {
    const text = await attemptOnce(client, systemInstruction, responseJsonSchema, promptText);
    return { text };
  } catch (err) {
    const classified = classifyGeminiError(err);
    console.error("[geminiProvider] attempt failed:", classified.type);

    if (!isImmediatelyRetryable(classified) || budget.used) {
      return { error: classified };
    }

    budget.used = true;
    await sleep(500);

    try {
      const text = await attemptOnce(client, systemInstruction, responseJsonSchema, promptText);
      return { text };
    } catch (err2) {
      const classified2 = classifyGeminiError(err2);
      console.error("[geminiProvider] retry failed:", classified2.type);
      return { error: classified2 };
    }
  }
}

// Exported so other pipeline stages (e.g. the resource-finder pipeline's
// understanding/verification steps) can reuse the same retry/timeout/quota
// classification without duplicating it against a different schema.
export async function generateStructured<T>(
  schema: z.ZodType<T>,
  jsonSchema: unknown,
  systemInstruction: string,
  userPrompt: string,
): Promise<AIOutcome<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: providerError("AUTHENTICATION") };
  }

  const client = new GoogleGenAI({ apiKey });
  const budget: RetryBudget = { used: false };

  const first = await callWithBoundedRetry(client, systemInstruction, jsonSchema, userPrompt, budget);
  if (first.error) {
    return { ok: false, error: first.error };
  }

  let validated = schema.safeParse(safeJsonParse(first.text));

  if (!validated.success) {
    const issues = JSON.stringify(validated.error.issues).slice(0, 800);
    const repairPrompt = `${userPrompt}\n\nYour previous output did not match the required schema. Issues: ${issues}\nReturn ONLY corrected JSON matching the schema exactly.`;

    const repaired = await callWithBoundedRetry(
      client,
      systemInstruction,
      jsonSchema,
      repairPrompt,
      budget,
    );
    if (repaired.error) {
      return { ok: false, error: repaired.error };
    }

    validated = schema.safeParse(safeJsonParse(repaired.text));
  }

  if (!validated.success) {
    return { ok: false, error: providerError("INVALID_RESPONSE") };
  }

  return { ok: true, data: validated.data };
}

export const geminiProvider: AIProvider = {
  async analyze(content: NormalizedContent): Promise<AIAnalysisOutcome> {
    const outcome = await generateStructured(
      analysisResultSchema,
      ANALYSIS_SCHEMA,
      SYSTEM_PROMPT,
      buildUserPrompt(content),
    );
    return outcome.ok ? { ok: true, analysis: outcome.data } : outcome;
  },

  async explainSimply(input: ExplainInput) {
    return generateStructured(
      explainResultSchema,
      EXPLAIN_SCHEMA,
      EXPLAIN_SYSTEM_PROMPT,
      buildExplainPrompt(input),
    );
  },

  async turnIntoSteps(input: StepsInput) {
    return generateStructured(
      stepsResultSchema,
      STEPS_SCHEMA,
      STEPS_SYSTEM_PROMPT,
      buildStepsPrompt(input),
    );
  },
};
