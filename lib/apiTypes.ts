import type { NormalizedContent } from "@/lib/content/types";
import type { AnalysisResult } from "@/lib/schemas/analysisResult";
import type { ExplainResult } from "@/lib/schemas/explainResult";

export type RetrievalStatus = "retrieved" | "blocked_or_private" | "unreachable" | "timeout" | "no_data";

export type ExplainResponse =
  | { success: true; explanation: ExplainResult }
  | { success: false; error: { code: string; message: string } };

export type StepsResponse =
  | { success: true; steps: string[] }
  | { success: false; error: { code: string; message: string } };

export type AnalyzeResponse =
  | {
      success: true;
      content: NormalizedContent;
      sufficientContent: boolean;
      retrieval: RetrievalStatus;
      analysis: AnalysisResult | null;
      aiError: { code: string; message: string } | null;
    }
  | {
      success: false;
      error: { code: string; message: string };
    };
