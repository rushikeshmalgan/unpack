import type { Candidate, Resolver } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

const TIMEOUT_MS = 8000;

interface GitHubItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  owner: { login: string };
  updated_at: string;
}

async function searchGitHub(query: string): Promise<Candidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { items?: GitHubItem[] };
    return (body.items ?? []).map((item) => ({
      url: item.html_url,
      title: item.full_name,
      source: "github.com",
      publishedDate: item.updated_at,
      snippet: item.description,
      meta: { stars: item.stargazers_count, language: item.language, owner: item.owner.login },
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const githubResolver: Resolver = {
  id: "github",
  handles(resourceType: string) {
    return resourceType === "github_repo" || resourceType === "library_package";
  },
  async search(pointer: Pointer): Promise<Candidate[]> {
    return searchGitHub(pointer.name);
  },
};
