import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson, resolverUserAgent } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

interface NominatimResult {
  osm_type: string;
  osm_id: number;
  display_name: string;
  type: string;
  importance: number;
}

// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application (not pretending to be a browser) and asks callers not to hammer
// it with concurrent requests — this resolver is only ever called for one
// place-type pointer at a time within our existing concurrency cap.
async function searchNominatim(query: string, ctx: ResolverContext): Promise<Candidate[]> {
  const params = new URLSearchParams({ q: query, format: "json", limit: "5" });
  if (ctx.locale) params.set("accept-language", ctx.locale);

  const results = await fetchSourceJson<NominatimResult[]>(
    ctx,
    "OpenStreetMap search",
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { headers: { "User-Agent": resolverUserAgent() } },
  );

  return (results ?? []).map((r) => ({
    url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
    title: r.display_name.split(",")[0],
    source: "openstreetmap.org",
    snippet: r.display_name,
    meta: { placeType: r.type, importance: r.importance },
  }));
}

export const placesResolver: Resolver = {
  id: "nominatim",
  handles(resourceType: string) {
    return resourceType === "place" || resourceType === "restaurant_or_cafe";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    const locationHint = pointer.attributes.location ? ` ${pointer.attributes.location}` : "";
    return searchNominatim(`${pointer.name}${locationHint}`, ctx);
  },
};
