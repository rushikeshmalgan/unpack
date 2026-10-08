import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
}

async function searchOpenLibrary(query: string, ctx: ResolverContext): Promise<Candidate[]> {
  const body = await fetchSourceJson<{ docs?: OpenLibraryDoc[] }>(
    ctx,
    "Open Library",
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`,
  );

  return (body?.docs ?? []).map((doc) => ({
    url: `https://openlibrary.org${doc.key}`,
    title: doc.title,
    source: "openlibrary.org",
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : null,
    snippet: doc.author_name ? `by ${doc.author_name.join(", ")}` : null,
  }));
}

export const bookResolver: Resolver = {
  id: "open_library",
  handles(resourceType: string) {
    return resourceType === "book";
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchOpenLibrary(pointer.name, ctx);
  },
};
