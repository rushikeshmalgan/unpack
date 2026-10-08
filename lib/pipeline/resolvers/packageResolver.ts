import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

interface NpmSearchObject {
  package: { name: string; version: string; description?: string; date: string; links?: { npm?: string } };
}

// npm has a real search API; PyPI's only public search is an HTML page (no
// JSON endpoint as of this check) — so Python packages fall through to the
// web-search resolver with a site:pypi.org restriction instead of a fake
// "search" that's really just an unverified name guess.
async function searchNpm(query: string, ctx: ResolverContext): Promise<Candidate[]> {
  const body = await fetchSourceJson<{ objects?: NpmSearchObject[] }>(
    ctx,
    "npm search",
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`,
  );

  return (body?.objects ?? []).map(({ package: pkg }) => ({
    url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
    title: pkg.name,
    source: "npmjs.com",
    publishedDate: pkg.date,
    snippet: pkg.description ?? null,
    meta: { version: pkg.version },
  }));
}

export const packageResolver: Resolver = {
  id: "npm",
  handles(resourceType: string) {
    return resourceType === "library_package";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchNpm(pointer.name, ctx);
  },
};
