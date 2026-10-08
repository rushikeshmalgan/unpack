import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

interface ITunesResult {
  trackName: string;
  trackViewUrl: string;
  artistName: string;
  averageUserRating?: number;
  userRatingCount?: number;
  formattedPrice?: string;
}

// iTunes Search covers the Apple App Store and is genuinely keyless. Google
// Play has no equivalent public search API, so app_mobile pointers that turn
// out to be Android-only fall through to the web-search resolver instead of
// a fake/broken dedicated resolver.
async function searchAppStore(query: string, ctx: ResolverContext): Promise<Candidate[]> {
  const body = await fetchSourceJson<{ results?: ITunesResult[] }>(
    ctx,
    "App Store search",
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&limit=5`,
  );

  return (body?.results ?? []).map((r) => ({
    url: r.trackViewUrl,
    title: r.trackName,
    popularity: r.userRatingCount,
    source: "apps.apple.com",
    snippet: `by ${r.artistName}`,
    meta: { rating: r.averageUserRating, price: r.formattedPrice },
  }));
}

export const appStoreResolver: Resolver = {
  id: "itunes",
  handles(resourceType: string) {
    return resourceType === "app_mobile";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchAppStore(pointer.name, ctx);
  },
};
