import { generateStructured } from "@/lib/ai/geminiProvider";
import { toGeminiJsonSchema } from "@/lib/ai/jsonSchema";
import { understandingResultSchema, type UnderstandingResult } from "@/lib/schemas/pipeline/understanding";
import { UNDERSTAND_SYSTEM_PROMPT, buildUnderstandPrompt } from "@/prompts/understand";
import type { IngestedSignals } from "@/lib/pipeline/ingest/ingestReel";
import type { AIOutcome } from "@/lib/ai/types";

const UNDERSTANDING_SCHEMA = toGeminiJsonSchema(understandingResultSchema);

export async function understandReel(signals: IngestedSignals): Promise<AIOutcome<UnderstandingResult>> {
  const prompt = buildUnderstandPrompt({
    contentType: signals.contentType,
    creatorUsername: signals.creatorUsername,
    caption: signals.caption,
    transcript: signals.transcript,
    onScreenText: signals.onScreenText,
    comments: signals.comments,
    bioLink: signals.bioLink,
  });

  return generateStructured(understandingResultSchema, UNDERSTANDING_SCHEMA, UNDERSTAND_SYSTEM_PROMPT, prompt);
}
