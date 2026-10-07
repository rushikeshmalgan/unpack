import { z } from "zod";

// Open-ended by design (resourceType is a free string, not an enum) — the LLM
// may propose "other:<label>" for anything not in this list. This list exists
// only so the resolver registry has exact strings to route on; anything that
// doesn't match falls through to the web-search resolver.
export const KNOWN_RESOURCE_TYPES = [
  "video", "playlist", "channel", "podcast_episode", "podcast",
  "article", "blog_post", "newsletter", "research_paper", "book",
  "course", "tutorial", "documentation", "website", "web_tool",
  "app_mobile", "app_desktop", "browser_extension", "github_repo",
  "library_package", "api", "dataset", "ai_model", "prompt",
  "template", "design_asset", "font", "product", "deal_or_coupon",
  "software_alternative", "place", "restaurant_or_cafe", "event",
  "recipe", "song", "album", "movie_or_show", "game",
  "job_or_internship", "scholarship_or_program", "community",
  "social_account", "person_profile", "quote_source", "news_event",
] as const;

export const reelTypeSchema = z.enum([
  "recommendation_list", "tutorial", "tool_demo", "product_showcase",
  "travel_or_place", "recipe", "news_or_explainer", "motivational",
  "promotion_or_lead_magnet", "entertainment", "other",
]);

export const pointerKindSchema = z.enum(["explicit", "implicit", "gated"]);

export const evidenceSchema = z.object({
  signal: z.enum(["caption", "audio", "onscreen", "visual", "comment", "bio"]),
  snippet: z.string(),
});

export const pointerSchema = z.object({
  id: z.string(),
  kind: pointerKindSchema,
  resourceType: z.string(),
  name: z.string(),
  attributes: z.object({
    creator: z.string().nullable(),
    year: z.string().nullable(),
    topic: z.string().nullable(),
    language: z.string().nullable(),
    location: z.string().nullable(),
    visibleUrl: z.string().nullable(),
    price: z.string().nullable(),
  }),
  // Capped at 3 (not a larger number): Gemini's responseJsonSchema rejects
  // the whole request with a bare 400 INVALID_ARGUMENT once the schema's
  // array-maxItems × nested-object complexity crosses an undocumented
  // internal limit — verified empirically (see pointers.max below too).
  evidence: z.array(evidenceSchema).max(3),
  confidence: z.number().min(0).max(1),
});

export const searchPlanSchema = z.object({
  pointerId: z.string(),
  queries: z.array(z.string()).min(1).max(4),
});

export const ctaDetectedSchema = z.object({
  type: z.enum(["comment_keyword", "follow", "link_in_bio", "none"]),
  keyword: z.string().nullable(),
});

export const understandingResultSchema = z.object({
  reelType: reelTypeSchema,
  creatorPromise: z.string().nullable(),
  ctaDetected: ctaDetectedSchema,
  // Capped at 8 (down from an originally-intended 12): combined with the
  // searchPlans array below, 12 reliably tripped Gemini's schema-complexity
  // limit (a bare 400 with no field-level detail). 8 is comfortably under
  // the empirically-found threshold (9 started failing) with real prompts.
  pointers: z.array(pointerSchema).max(8),
  topicIfNoPointers: z.string().nullable(),
  searchPlans: z.array(searchPlanSchema).max(8),
});

export type UnderstandingResult = z.infer<typeof understandingResultSchema>;
export type Pointer = z.infer<typeof pointerSchema>;
export type ReelType = z.infer<typeof reelTypeSchema>;
export type PointerKind = z.infer<typeof pointerKindSchema>;
