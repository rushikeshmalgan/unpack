import { z } from "zod";
import { MAX_URL_LENGTH, MAX_CAPTION_LENGTH, MAX_TRANSCRIPT_LENGTH } from "@/lib/validation";

export const unpackRequestSchema = z.object({
  url: z.string().min(1).max(MAX_URL_LENGTH),
  caption: z.string().max(MAX_CAPTION_LENGTH).optional(),
  transcript: z.string().max(MAX_TRANSCRIPT_LENGTH).optional(),
  comments: z.string().max(MAX_CAPTION_LENGTH).optional(),
  onScreenText: z.string().max(MAX_CAPTION_LENGTH).optional(),
  bioLink: z.string().max(500).optional(),
  mode: z.enum(["exact", "explore"]).default("exact"),
  locale: z.string().max(20).optional(),
});

export type UnpackRequest = z.infer<typeof unpackRequestSchema>;
