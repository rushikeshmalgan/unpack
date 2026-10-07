import type { Candidate, Resolver } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

const TIMEOUT_MS = 8000;

// arXiv's API returns Atom XML, not JSON — regex-extract the handful of
// fields we need rather than pulling in a full XML parser dependency for
// one resolver. The format is stable/predictable (one <entry> per result).
function parseArxivEntries(xml: string): Candidate[] {
  const entries = xml.split("<entry>").slice(1);
  return entries.slice(0, 5).map((entry) => {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "Untitled";
    const url = entry.match(/<link href="([^"]+)" rel="alternate"/)?.[1] ?? "";
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? null;
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 200);
    return { url, title, source: "arxiv.org", publishedDate: published, snippet: summary ?? null };
  }).filter((c) => c.url);
}

async function searchArxiv(query: string): Promise<Candidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=5`,
      { signal: controller.signal },
    );
    if (!res.ok) return [];
    return parseArxivEntries(await res.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const academicResolver: Resolver = {
  id: "arxiv",
  handles(resourceType: string) {
    return resourceType === "research_paper";
  },
  async search(pointer: Pointer): Promise<Candidate[]> {
    return searchArxiv(pointer.name);
  },
};
