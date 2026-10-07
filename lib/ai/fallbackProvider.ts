import type { AIProvider, AIAnalysisOutcome, AIOutcome, ExplainInput, StepsInput } from "@/lib/ai/types";
import type { AIProviderError } from "@/lib/ai/providerError";
import type { NormalizedContent } from "@/lib/content/types";
import type { ExplainResult } from "@/lib/schemas/explainResult";
import type { StepsResult } from "@/lib/schemas/stepsResult";

// QUOTA_EXCEEDED needs an explicit opt-in: a different provider's quota has
// nothing to do with Gemini's, so falling back *could* help, but we don't
// want fallback traffic silently kicking in every time the free tier runs
// out unless that's a deliberate choice (it likely means doubling AI spend).
function shouldFallback(error: AIProviderError, fallbackOnQuota: boolean): boolean {
  if (error.type === "QUOTA_EXCEEDED") return fallbackOnQuota;
  return true;
}

export class FallbackAIProvider implements AIProvider {
  constructor(
    private primary: AIProvider,
    private fallback: AIProvider,
    private fallbackOnQuota: boolean,
  ) {}

  async analyze(content: NormalizedContent): Promise<AIAnalysisOutcome> {
    const result = await this.primary.analyze(content);
    if (result.ok || !shouldFallback(result.error, this.fallbackOnQuota)) return result;
    console.warn(`[FallbackAIProvider] primary analyze failed (${result.error.type}), trying fallback`);
    return this.fallback.analyze(content);
  }

  async explainSimply(input: ExplainInput): Promise<AIOutcome<ExplainResult>> {
    const result = await this.primary.explainSimply(input);
    if (result.ok || !shouldFallback(result.error, this.fallbackOnQuota)) return result;
    console.warn(`[FallbackAIProvider] primary explainSimply failed (${result.error.type}), trying fallback`);
    return this.fallback.explainSimply(input);
  }

  async turnIntoSteps(input: StepsInput): Promise<AIOutcome<StepsResult>> {
    const result = await this.primary.turnIntoSteps(input);
    if (result.ok || !shouldFallback(result.error, this.fallbackOnQuota)) return result;
    console.warn(`[FallbackAIProvider] primary turnIntoSteps failed (${result.error.type}), trying fallback`);
    return this.fallback.turnIntoSteps(input);
  }
}
