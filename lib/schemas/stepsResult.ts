import { z } from "zod";

export const stepsResultSchema = z.object({
  steps: z.array(z.string()).max(15),
});

export type StepsResult = z.infer<typeof stepsResultSchema>;
