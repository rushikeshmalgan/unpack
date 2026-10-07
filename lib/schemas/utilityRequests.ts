import { z } from "zod";

export const explainRequestSchema = z.object({
  summary: z.string().min(1).max(4000),
  technologies: z.array(z.string().max(100)).max(30).optional(),
});

export const stepsRequestSchema = z.object({
  summary: z.string().min(1).max(4000),
  whatUserShouldDo: z.array(z.string().max(300)).max(20).optional(),
  actionItems: z.array(z.string().max(300)).max(20).optional(),
  technologies: z.array(z.string().max(100)).max(30).optional(),
});
