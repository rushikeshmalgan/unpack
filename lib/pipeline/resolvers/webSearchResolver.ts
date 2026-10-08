import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

const TIMEOUT_MS = 10_000;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

// The universal fallback — handles any resourceType not claimed by a more
// specific resolver. Only Tavily is implemented (its exact request/response
// shape was verified against live docs before writing this); Brave/Serper/
// Google PSE are not wired up yet — add a sibling file following this same
// shape and register it if you need a different provider.
async function searchTavily(query: string, ctx: ResolverContext): Promise<Candidate[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    ctx.reportIssue?.("Web search isn't enabled on this server");
    return [];
  }

  const body = await fetchSourceJson<{ results?: TavilyResult[] }>(ctx, "Web search", "https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: 5, include_published_date: true }),
    timeoutMs: TIMEOUT_MS,
  });

  return (body?.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    source: safeHostname(r.url),
    publishedDate: r.published_date ?? null,
    snippet: r.content,
  }));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}

// A short per-resourceType hint keeps generic queries from wandering —
// e.g. a "course" pointer searched plainly often surfaces blog posts
// about the topic rather than the course itself.
const QUERY_HINTS: Partial<Record<string, string>> = {
  course: "course",
  website: "official site",
  web_tool: "official site",
  software_alternative: "alternative to",
  product: "official",
  job_or_internship: "careers",
  social_account: "official account",
  library_package: "pypi OR site:pypi.org",
};

export const webSearchResolver: Resolver = {
  id: "web_search",
  handles(): boolean {
    // Deliberately matches everything — it's the registry's fallback, wired
    // in last so more specific resolvers get first refusal.
    return true;
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    const hint = QUERY_HINTS[pointer.resourceType];
    const query = hint ? `${pointer.name} ${hint}` : pointer.name;
    return searchTavily(query, ctx);
  },
};
