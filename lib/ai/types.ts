import type { NormalizedContent } from "@/lib/content/types";
import type { AnalysisResult } from "@/lib/schemas/analysisResult";
import type { ExplainResult } from "@/lib/schemas/explainResult";
import type { StepsResult } from "@/lib/schemas/stepsResult";
import type { AIProviderError } from "@/lib/ai/providerError";

export type AIOutcome<T> = { ok: true; data: T } | { ok: false; error: AIProviderError };

export type AIAnalysisOutcome =
  | { ok: true; analysis: AnalysisResult }
  | { ok: false; error: AIProviderError };

export interface ExplainInput {
  summary: string;
  technologies?: string[];
}

export interface StepsInput {
  summary: string;
  whatUserShouldDo?: string[];
  actionItems?: string[];
  technologies?: string[];
}

export interface AIProvider {
  analyze(content: NormalizedContent): Promise<AIAnalysisOutcome>;
  explainSimply(input: ExplainInput): Promise<AIOutcome<ExplainResult>>;
  turnIntoSteps(input: StepsInput): Promise<AIOutcome<StepsResult>>;
}
