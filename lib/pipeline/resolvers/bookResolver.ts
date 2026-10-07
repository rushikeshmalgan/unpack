import type { Candidate, Resolver } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

const TIMEOUT_MS = 8000;

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
}

async function searchOpenLibrary(query: string): Promise<Candidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { docs?: OpenLibraryDoc[] };
    return (body.docs ?? []).map((doc) => ({
      url: `https://openlibrary.org${doc.key}`,
      title: doc.title,
      source: "openlibrary.org",
      publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : null,
      snippet: doc.author_name ? `by ${doc.author_name.join(", ")}` : null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const bookResolver: Resolver = {
  id: "open_library",
  handles(resourceType: string) {
    return resourceType === "book";
  },
  async search(pointer: Pointer): Promise<Candidate[]> {
    return searchOpenLibrary(pointer.name);
  },
};
