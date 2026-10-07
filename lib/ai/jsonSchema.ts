import { z } from "zod";

// Gemini's responseJsonSchema only honors a fixed subset of JSON Schema keywords
// and doesn't recognize a top-level "$schema" key — strip it after Zod generates it.
export function toGeminiJsonSchema(schema: z.ZodType): unknown {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}
