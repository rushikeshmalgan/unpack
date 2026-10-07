import type { Candidate, Resolver } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

const TIMEOUT_MS = 8000;

interface NpmSearchObject {
  package: { name: string; version: string; description?: string; date: string; links?: { npm?: string } };
}

// npm has a real search API; PyPI's only public search is an HTML page (no
// JSON endpoint as of this check) — so Python packages fall through to the
// web-search resolver with a site:pypi.org restriction instead of a fake
// "search" that's really just an unverified name guess.
async function searchNpm(query: string): Promise<Candidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { objects?: NpmSearchObject[] };
    return (body.objects ?? []).map(({ package: pkg }) => ({
      url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
      title: pkg.name,
      source: "npmjs.com",
      publishedDate: pkg.date,
      snippet: pkg.description ?? null,
      meta: { version: pkg.version },
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const packageResolver: Resolver = {
  id: "npm",
  handles(resourceType: string) {
    return resourceType === "library_package";
  },
  async search(pointer: Pointer): Promise<Candidate[]> {
    return searchNpm(pointer.name);
  },
};
