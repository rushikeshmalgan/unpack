import { validateInstagramUrl, describeUrlError } from "@/lib/validation";
import { instagramProvider } from "@/lib/content/instagramProvider";
import { extractUrls } from "@/lib/content/htmlMeta";
import type { NormalizedContent } from "@/lib/content/types";

const MIN_SUFFICIENT_LENGTH = 20;

export interface RetrieveInput {
  url: string;
  caption?: string;
  transcript?: string;
}

export type RetrieveOutcome =
  | { status: "invalid_url"; message: string }
  | {
      status: "ok";
      content: NormalizedContent;
      sufficient: boolean;
      retrieval: "retrieved" | "blocked_or_private" | "unreachable" | "timeout" | "no_data";
    };

export async function retrieveContent(input: RetrieveInput): Promise<RetrieveOutcome> {
  const validated = validateInstagramUrl(input.url);
  if (!validated.ok) {
    return { status: "invalid_url", message: describeUrlError(validated.reason) };
  }

  const manualCaption = input.caption?.trim() || null;
  const manualTranscript = input.transcript?.trim() || null;

  const result = await instagramProvider.retrieve(validated.normalizedUrl);

  const retrievedCaption = result.ok ? result.caption : null;
  const caption = manualCaption ?? retrievedCaption;
  const transcript = manualTranscript;

  const content: NormalizedContent = {
    sourceUrl: validated.normalizedUrl,
    platform: "instagram",
    contentType: validated.contentType,
    creator: { username: result.ok ? result.creatorUsername : null },
    caption,
    transcript,
    links: extractUrls([caption, transcript].filter(Boolean).join(" ")),
    metadata: {
      title: result.ok ? result.title : null,
      description: result.ok ? result.description : null,
      imageUrl: result.ok ? result.imageUrl : null,
      retrievedVia: result.ok ? "open_graph" : manualCaption || manualTranscript ? "manual_only" : "unavailable",
    },
  };

  const sufficient =
    (caption?.length ?? 0) >= MIN_SUFFICIENT_LENGTH ||
    (transcript?.length ?? 0) >= MIN_SUFFICIENT_LENGTH;

  return {
    status: "ok",
    content,
    sufficient,
    retrieval: result.ok ? "retrieved" : result.reason === "no_data" ? "no_data" : result.reason,
  };
}
