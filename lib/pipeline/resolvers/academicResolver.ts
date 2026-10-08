import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceText } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

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

// null = the request itself failed; [] = arXiv answered with no matches. The
// difference matters: only a genuine "no matches" should trigger the fallback
// query (retrying a failing service just doubles the load on it).
async function fetchArxiv(searchQuery: string, ctx: ResolverContext): Promise<Candidate[] | null> {
  const xml = await fetchSourceText(
    ctx,
    "arXiv search",
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&max_results=5`,
  );
  return xml === null ? null : parseArxivEntries(xml);
}

// A pointer name is usually a paper title, and arXiv's loose `all:` match on
// an unquoted multi-word query buries it: "Attention Is All You Need" returned
// unrelated papers and missed the real one entirely. A quoted title-field
// phrase puts it first. If the name isn't an exact title (the model
// paraphrased), fall back to requiring every significant word somewhere.
async function searchArxiv(name: string, ctx: ResolverContext): Promise<Candidate[]> {
  const phrase = name.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  if (!phrase) return [];

  const exact = await fetchArxiv(`ti:"${phrase}"`, ctx);
  if (exact === null || exact.length > 0) return exact ?? [];

  const terms = (phrase.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 2).slice(0, 6);
  if (terms.length === 0) return [];
  return (await fetchArxiv(terms.map((t) => `all:${t}`).join(" AND "), ctx)) ?? [];
}

export const academicResolver: Resolver = {
  id: "arxiv",
  handles(resourceType: string) {
    return resourceType === "research_paper";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchArxiv(pointer.name, ctx);
  },
};
