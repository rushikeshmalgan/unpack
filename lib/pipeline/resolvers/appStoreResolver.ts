import type { Candidate, Resolver } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

const TIMEOUT_MS = 8000;

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
async function searchAppStore(query: string): Promise<Candidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&limit=5`,
      { signal: controller.signal },
    );
    if (!res.ok) return [];

    const body = (await res.json()) as { results?: ITunesResult[] };
    return (body.results ?? []).map((r) => ({
      url: r.trackViewUrl,
      title: r.trackName,
      popularity: r.userRatingCount,
      source: "apps.apple.com",
      snippet: `by ${r.artistName}`,
      meta: { rating: r.averageUserRating, price: r.formattedPrice },
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const appStoreResolver: Resolver = {
  id: "itunes",
  handles(resourceType: string) {
    return resourceType === "app_mobile";
  },
  async search(pointer: Pointer): Promise<Candidate[]> {
    return searchAppStore(pointer.name);
  },
};
