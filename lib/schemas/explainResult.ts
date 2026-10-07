import { z } from "zod";

export const explainResultSchema = z.object({
  overview: z.string(),
  terms: z
    .array(
      z.object({
        term: z.string(),
        simple: z.string(),
      }),
    )
    .max(10),
});

export type ExplainResult = z.infer<typeof explainResultSchema>;
