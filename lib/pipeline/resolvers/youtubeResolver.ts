import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

type YouTubeKind = "video" | "channel" | "playlist";

interface YouTubeItem {
  id: { videoId?: string; channelId?: string; playlistId?: string };
  snippet: { title: string; channelTitle: string; publishedAt: string };
}

function resourceTypeToKind(resourceType: string): YouTubeKind {
  if (resourceType === "channel") return "channel";
  if (resourceType === "playlist") return "playlist";
  return "video";
}

function buildUrl(kind: YouTubeKind, item: YouTubeItem): string | null {
  if (kind === "video" && item.id.videoId) return `https://www.youtube.com/watch?v=${item.id.videoId}`;
  if (kind === "channel" && item.id.channelId) return `https://www.youtube.com/channel/${item.id.channelId}`;
  if (kind === "playlist" && item.id.playlistId) return `https://www.youtube.com/playlist?list=${item.id.playlistId}`;
  return null;
}

async function searchYouTube(query: string, kind: YouTubeKind, ctx: ResolverContext): Promise<Candidate[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    ctx.reportIssue?.("YouTube search isn't enabled on this server");
    return [];
  }

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: kind,
    maxResults: "5",
    key: apiKey,
  });
  const body = await fetchSourceJson<{ items?: YouTubeItem[] }>(
    ctx,
    "YouTube search",
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
  );

  const candidates: Candidate[] = [];
  for (const item of body?.items ?? []) {
    const url = buildUrl(kind, item);
    if (!url) continue;
    candidates.push({
      url,
      title: item.snippet.title,
      source: "youtube.com",
      publishedDate: item.snippet.publishedAt,
      snippet: item.snippet.channelTitle,
      meta: { channelTitle: item.snippet.channelTitle },
    });
  }
  return candidates;
}

export const youtubeResolver: Resolver = {
  id: "youtube",
  handles(resourceType: string) {
    return resourceType === "video" || resourceType === "channel" || resourceType === "playlist";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchYouTube(pointer.name, resourceTypeToKind(pointer.resourceType), ctx);
  },
};
