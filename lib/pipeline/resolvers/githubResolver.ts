import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

interface GitHubItem {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  owner: { login: string };
  updated_at: string;
}

// Unauthenticated GitHub search is capped at 10 requests/minute per IP — on
// shared serverless egress that is effectively always exhausted, so a
// GITHUB_TOKEN (30/min, and per-token rather than per-IP) is what makes this
// resolver dependable in production.
async function searchGitHub(query: string, ctx: ResolverContext): Promise<Candidate[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const body = await fetchSourceJson<{ items?: GitHubItem[] }>(
    ctx,
    "GitHub search",
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`,
    { headers },
  );

  return (body?.items ?? []).map((item) => ({
    url: item.html_url,
    title: item.full_name,
    aliases: [item.name],
    popularity: item.stargazers_count,
    source: "github.com",
    publishedDate: item.updated_at,
    snippet: item.description,
    meta: { stars: item.stargazers_count, language: item.language, owner: item.owner.login },
  }));
}

export const githubResolver: Resolver = {
  id: "github",
  handles(resourceType: string) {
    return resourceType === "github_repo" || resourceType === "library_package";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchGitHub(pointer.name, ctx);
  },
};
