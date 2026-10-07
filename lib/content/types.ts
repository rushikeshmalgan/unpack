export type Platform = "instagram";
export type ContentKind = "reel" | "post";

export interface NormalizedContent {
  sourceUrl: string;
  platform: Platform;
  contentType: ContentKind;
  creator: { username: string | null };
  caption: string | null;
  transcript: string | null;
  links: string[];
  metadata: {
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    retrievedVia: "open_graph" | "manual_only" | "unavailable";
  };
}

export type RetrievalFailureReason =
  | "unreachable"
  | "blocked_or_private"
  | "timeout"
  | "no_data";

export type ProviderResult =
  | {
      ok: true;
      caption: string | null;
      creatorUsername: string | null;
      title: string | null;
      description: string | null;
      imageUrl: string | null;
    }
  | { ok: false; reason: RetrievalFailureReason };

export interface ContentProvider {
  platform: Platform;
  canHandle(url: string): boolean;
  retrieve(url: string): Promise<ProviderResult>;
}
