import { z } from "zod";
import { MAX_CAPTION_LENGTH, MAX_TRANSCRIPT_LENGTH, MAX_URL_LENGTH } from "@/lib/validation";

export const analyzeRequestSchema = z.object({
  url: z.string().min(1).max(MAX_URL_LENGTH),
  caption: z.string().max(MAX_CAPTION_LENGTH).optional(),
  transcript: z.string().max(MAX_TRANSCRIPT_LENGTH).optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
