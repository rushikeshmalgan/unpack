import { z } from "zod";

export const ctaActionSchema = z.enum([
  "comment",
  "follow",
  "like",
  "share",
  "save",
  "dm",
  "visit_link",
  "subscribe",
  "download",
  "other",
  "none",
]);

export const contentIntentSchema = z.enum([
  "educational",
  "promotional",
  "personal_opinion",
  "tutorial",
  "recommendation",
  "advertisement",
  "giveaway",
  "resource_distribution",
  "career_advice",
  "entertainment",
  "other",
]);

export const analysisResultSchema = z.object({
  topic: z.string(),
  classification: z.object({
    category: z.string(),
    subcategory: z.string().nullable(),
    audience: z.string().nullable(),
    intent: contentIntentSchema,
  }),
  summary: z.object({
    tldr: z.string(),
    quick: z.string(),
    detailed: z.string(),
  }),
  cta: z.object({
    detected: z.boolean(),
    action: ctaActionSchema,
    keyword: z.string().nullable(),
    instruction: z.string().nullable(),
  }),
  whatUserShouldDo: z.array(z.string()).max(10),
  whatUserGets: z.object({
    identified: z.boolean(),
    description: z.string().nullable(),
  }),
  keyTakeaways: z.array(z.string()).max(7),
  actionItems: z.array(z.string()).max(12),
  resources: z.object({
    websites: z.array(z.string()),
    tools: z.array(z.string()),
    courses: z.array(z.string()),
    books: z.array(z.string()),
    repositories: z.array(z.string()),
    people: z.array(z.string()),
    companies: z.array(z.string()),
  }),
  technologies: z.array(z.string()),
  contentNotes: z
    .array(
      z.object({
        kind: z.enum(["direct", "inferred", "interpretation"]),
        note: z.string(),
      }),
    )
    .max(10),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
