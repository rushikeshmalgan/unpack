import type { Candidate, Resolver, ResolverContext } from "@/lib/pipeline/resolvers/types";
import { fetchSourceJson, resolverUserAgent } from "@/lib/pipeline/resolvers/http";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

// Wikidata is a free, keyless knowledge base that records an "official
// website" (property P856) for software, apps, sites and games. It gives the
// most common reel type — a list of tools — a real, authoritative link with
// no API key. Coverage is by notability: Figma, Notion, Raycast and CapCut
// resolve; newer or generically-named products (Linear, Arc) are simply
// absent, in which case this returns nothing and the web-search fallback (if
// configured) takes over. It deliberately never guesses.
const API = "https://www.wikidata.org/w/api.php";
const MAX_RESULTS = 3;

// Anonymous Wikidata access allows only about ten requests in a short window
// before answering 429, and each lookup here costs two (search, then the
// website claim). That comfortably covers a handful of tools; a long list can
// run into it. The pipeline then says "Wikidata is rate-limited" rather than
// "not found", and with the Redis cache enabled popular tools are looked up
// once per day instead of once per reel.

const HANDLED_TYPES = new Set([
  "web_tool",
  "website",
  "app_desktop",
  "app_mobile",
  "browser_extension",
  "software_alternative",
  "ai_model",
  "game",
]);

// A name alone is ambiguous on Wikidata ("Figma" is also a Japanese
// action-figure brand, "cursor" a UI pointer, "LINEAR" an asteroid survey),
// and every one of those has an exact label match. The description is what
// separates the software from the namesake.
const SOFTWARE_DESCRIPTION =
  /\b(software|app|application|platform|website|web ?(?:app|site|service|browser)|online|service|tool|editor|browser|framework|library|search engine|game|launcher|extension|plug-?in|client|programming language|operating system|chatbot|language model|saas|cloud)\b/i;

interface SearchHit {
  id: string;
  label?: string;
  description?: string;
  match?: { type?: string; text?: string };
}

interface Claim {
  rank?: "preferred" | "normal" | "deprecated";
  mainsnak?: { datavalue?: { value?: unknown } };
}

interface EntityMap {
  entities?: Record<string, { claims?: { P856?: Claim[] } }>;
}

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Wikidata marks superseded values "deprecated" (Notion lists notion.so as
// deprecated alongside the current notion.com), so rank has to be honored
// rather than taking the first value.
function officialWebsite(claims: Claim[] | undefined): URL | null {
  const usable = (claims ?? []).filter((c) => c.rank !== "deprecated");
  const ordered = [...usable.filter((c) => c.rank === "preferred"), ...usable.filter((c) => c.rank !== "preferred")];
  for (const claim of ordered) {
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url;
    } catch {
      // not a URL — try the next claim
    }
  }
  return null;
}

async function searchWikidata(name: string, ctx: ResolverContext): Promise<Candidate[]> {
  const wanted = normalize(name);
  if (!wanted) return [];

  const search = await fetchSourceJson<{ search?: SearchHit[] }>(
    ctx,
    "Wikidata",
    `${API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json`,
    { headers: { "User-Agent": resolverUserAgent() } },
  );

  const hits = (search?.search ?? [])
    .filter(
      (hit) =>
        (hit.match?.type === "label" || hit.match?.type === "alias") &&
        normalize(hit.match.text ?? "") === wanted &&
        SOFTWARE_DESCRIPTION.test(hit.description ?? ""),
    )
    .slice(0, MAX_RESULTS);
  if (hits.length === 0) return [];

  const entities = await fetchSourceJson<EntityMap>(
    ctx,
    "Wikidata",
    `${API}?action=wbgetentities&ids=${hits.map((h) => h.id).join("|")}&props=claims&format=json`,
    { headers: { "User-Agent": resolverUserAgent() } },
  );

  const candidates: Candidate[] = [];
  for (const hit of hits) {
    const website = officialWebsite(entities?.entities?.[hit.id]?.claims?.P856);
    if (!website) continue;
    candidates.push({
      url: website.toString(),
      title: hit.label ?? name,
      // When the match was via an alias ("VS Code" for "Visual Studio Code"),
      // keep it so ranking sees the exact name the pointer used.
      aliases: hit.match?.text ? [hit.match.text] : undefined,
      source: website.hostname.replace(/^www\./, ""),
      snippet: hit.description ?? null,
      meta: { wikidataId: hit.id },
    });
  }
  return candidates;
}

export const wikidataResolver: Resolver = {
  id: "wikidata",
  handles(resourceType: string) {
    return HANDLED_TYPES.has(resourceType);
  },
  async search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
    return searchWikidata(pointer.name, ctx);
  },
};
