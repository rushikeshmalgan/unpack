import { afterEach, describe, expect, it, vi } from "vitest";
import { wikidataResolver } from "@/lib/pipeline/resolvers/wikidataResolver";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";

function pointer(name: string, resourceType = "web_tool"): Pointer {
  return {
    id: "p1",
    kind: "explicit",
    resourceType,
    name,
    attributes: { creator: null, year: null, topic: null, language: null, location: null, visibleUrl: null, price: null },
    evidence: [],
    confidence: 0.9,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

const hit = (id: string, label: string, description: string, type = "label", text = label) => ({
  id,
  label,
  description,
  match: { type, language: "en", text },
});

const claim = (value: unknown, rank: "preferred" | "normal" | "deprecated" = "normal") => ({
  rank,
  mainsnak: { datavalue: { value } },
});

// Queues the two Wikidata calls: wbsearchentities, then wbgetentities.
function stubWikidata(searchHits: unknown[], claimsById: Record<string, unknown[]> = {}) {
  const entities = Object.fromEntries(Object.entries(claimsById).map(([id, P856]) => [id, { claims: { P856 } }]));
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(ok({ search: searchHits }))
    .mockResolvedValueOnce(ok({ entities }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wikidataResolver", () => {
  it("handles tool / site / app / game pointers, but not books, places or videos", () => {
    for (const t of ["web_tool", "website", "app_desktop", "app_mobile", "software_alternative", "ai_model", "game"]) {
      expect(wikidataResolver.handles(t)).toBe(true);
    }
    for (const t of ["book", "place", "video", "github_repo", "research_paper"]) {
      expect(wikidataResolver.handles(t)).toBe(false);
    }
  });

  it("resolves a well-known tool to its official website", async () => {
    stubWikidata(
      [hit("Q96186334", "Figma", "online vector graphics editor and prototyping tool")],
      { Q96186334: [claim("https://www.figma.com")] },
    );
    const [c] = await wikidataResolver.search(pointer("Figma"), {});
    expect(c.url).toBe("https://www.figma.com/");
    expect(c.title).toBe("Figma");
    expect(c.source).toBe("figma.com");
    expect(c.snippet).toBe("online vector graphics editor and prototyping tool");
    expect(c.meta).toEqual({ wikidataId: "Q96186334" });
  });

  it("ignores a same-named entity that isn't software (Figma is also a Japanese action-figure brand)", async () => {
    const fetchMock = stubWikidata(
      [
        hit("Q307650", "Figma", "brand of Japanese action figures"),
        hit("Q96186334", "Figma", "online vector graphics editor and prototyping tool"),
      ],
      { Q96186334: [claim("https://www.figma.com")] },
    );
    const results = await wikidataResolver.search(pointer("Figma"), {});
    expect(results.map((r) => r.meta?.wikidataId)).toEqual(["Q96186334"]);
    // Only the software entity is looked up for its website.
    expect(fetchMock.mock.calls[1][0]).toContain("ids=Q96186334&");
  });

  it("honors claim rank: uses the preferred website and never a deprecated one (Notion lists both notion.com and notion.so)", async () => {
    stubWikidata(
      [hit("Q60747998", "Notion", "productivity software")],
      { Q60747998: [claim("https://www.notion.so", "deprecated"), claim("https://www.notion.com", "preferred")] },
    );
    const [c] = await wikidataResolver.search(pointer("Notion"), {});
    expect(c.url).toBe("https://www.notion.com/");
  });

  it("skips an entity whose only website is deprecated", async () => {
    stubWikidata(
      [hit("Q1", "OldTool", "web application")],
      { Q1: [claim("https://old.example", "deprecated")] },
    );
    expect(await wikidataResolver.search(pointer("OldTool"), {})).toEqual([]);
  });

  it("requires the name to match exactly — a near name is not good enough to guess a site", async () => {
    const fetchMock = stubWikidata([hit("Q9", "Figma Design Systems", "software")]);
    expect(await wikidataResolver.search(pointer("Figma"), {})).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no website lookup at all
  });

  it("returns nothing when the only exact match isn't software (an acronym alias of an asteroid survey for 'Linear')", async () => {
    const fetchMock = stubWikidata([
      hit("Q735603", "Lincoln Near-Earth Asteroid Research", "research project, collaboration between the U.S. Air Force and NASA", "alias", "LINEAR"),
      hit("Q37152072", "Linear", "family name"),
    ]);
    expect(await wikidataResolver.search(pointer("Linear"), {})).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("matches through an alias and keeps it for ranking ('VS Code' -> Visual Studio Code)", async () => {
    stubWikidata(
      [hit("Q1", "Visual Studio Code", "source code editor developed by Microsoft", "alias", "VS Code")],
      { Q1: [claim("https://code.visualstudio.com/")] },
    );
    const [c] = await wikidataResolver.search(pointer("VS Code"), {});
    expect(c.title).toBe("Visual Studio Code");
    expect(c.aliases).toEqual(["VS Code"]);
  });

  it("compares names ignoring case, punctuation and accents", async () => {
    stubWikidata(
      [hit("Q1", "Café-Tool", "web application")],
      { Q1: [claim("https://cafetool.example")] },
    );
    expect(await wikidataResolver.search(pointer("cafe tool"), {})).toHaveLength(1);
  });

  it("skips entities that have no official website", async () => {
    stubWikidata([hit("Q1", "Ghost", "mobile app")], { Q1: [] });
    expect(await wikidataResolver.search(pointer("Ghost"), {})).toEqual([]);
  });

  it("rejects a non-http(s) website value", async () => {
    stubWikidata([hit("Q1", "Weird", "web application")], { Q1: [claim("javascript:alert(1)"), claim("ftp://x.example")] });
    expect(await wikidataResolver.search(pointer("Weird"), {})).toEqual([]);
  });

  it("falls through to the next website claim when one value is malformed", async () => {
    stubWikidata([hit("Q1", "Odd", "web application")], { Q1: [claim("not a url"), claim(42), claim("https://odd.example")] });
    const [c] = await wikidataResolver.search(pointer("Odd"), {});
    expect(c.url).toBe("https://odd.example/");
  });

  it("makes a single request when search finds nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ search: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await wikidataResolver.search(pointer("Arc"), {})).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("identifies itself with a descriptive User-Agent, per Wikimedia's API etiquette", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ search: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await wikidataResolver.search(pointer("Figma"), {});
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toContain("UnpackResourceFinder");
  });

  it("URL-encodes the name so it can't alter the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ search: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await wikidataResolver.search(pointer("a&action=wbeditentity|b"), {});
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("action")).toBe("wbsearchentities");
    expect(url.searchParams.get("search")).toBe("a&action=wbeditentity|b");
  });

  it("reports an outage instead of presenting it as 'nothing found'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response));
    const reportIssue = vi.fn();
    expect(await wikidataResolver.search(pointer("Figma"), { reportIssue })).toEqual([]);
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("Wikidata is unavailable right now");
  });

  it("caps results at three", async () => {
    const hits = ["Q1", "Q2", "Q3", "Q4"].map((id) => hit(id, "Same", "web application"));
    stubWikidata(hits, Object.fromEntries(["Q1", "Q2", "Q3", "Q4"].map((id) => [id, [claim(`https://${id.toLowerCase()}.example`)]])));
    expect(await wikidataResolver.search(pointer("Same"), {})).toHaveLength(3);
  });
});
