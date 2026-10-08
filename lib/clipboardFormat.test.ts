import { describe, expect, it } from "vitest";
import {
  formatActionItems,
  formatAllLinks,
  formatFullAnalysis,
  formatKeyTakeaways,
  formatLinks,
  formatResources,
  formatWhatShouldIDo,
} from "@/lib/clipboardFormat";
import type { PipelineResult, LinkResult } from "@/lib/schemas/pipeline/response";
import type { AnalysisResult } from "@/lib/schemas/analysisResult";
import type { NormalizedContent } from "@/lib/content/types";

function fixtureAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    topic: "AI Engineer Roadmap",
    classification: { category: "Career", subcategory: null, audience: null, intent: "resource_distribution" },
    summary: { tldr: "A roadmap post.", quick: "Quick summary.", detailed: "Detailed breakdown." },
    cta: { detected: true, action: "comment", keyword: "GUIDE", instruction: "Comment GUIDE" },
    whatUserShouldDo: ["Follow @creator", "Comment GUIDE"],
    whatUserGets: { identified: true, description: "The AI roadmap" },
    keyTakeaways: ["Takeaway one", "Takeaway two"],
    actionItems: ["Learn Python", "Learn APIs"],
    resources: {
      websites: ["github.com"],
      tools: [],
      courses: [],
      books: [],
      repositories: [],
      people: [],
      companies: [],
    },
    technologies: ["Python", "RAG"],
    contentNotes: [{ kind: "direct", note: "Caption explicitly says this." }],
    ...overrides,
  };
}

function fixtureContent(overrides: Partial<NormalizedContent> = {}): NormalizedContent {
  return {
    sourceUrl: "https://www.instagram.com/reel/abc/",
    platform: "instagram",
    contentType: "reel",
    creator: { username: null },
    caption: "caption",
    transcript: null,
    links: [],
    metadata: { title: null, description: null, imageUrl: null, retrievedVia: "manual_only" },
    ...overrides,
  };
}

describe("formatKeyTakeaways", () => {
  it("formats as a bullet list", () => {
    expect(formatKeyTakeaways(fixtureAnalysis())).toBe("- Takeaway one\n- Takeaway two");
  });
});

describe("formatActionItems", () => {
  it("formats as an unchecked checklist", () => {
    expect(formatActionItems(fixtureAnalysis())).toBe("- [ ] Learn Python\n- [ ] Learn APIs");
  });
});

describe("formatWhatShouldIDo", () => {
  it("formats as a bullet list", () => {
    expect(formatWhatShouldIDo(fixtureAnalysis())).toBe("- Follow @creator\n- Comment GUIDE");
  });
});

describe("formatResources", () => {
  it("includes only non-empty resource groups", () => {
    const text = formatResources(fixtureAnalysis());
    expect(text).toBe("Websites: github.com");
    expect(text).not.toContain("Tools:");
  });

  it("returns an empty string when there are no resources at all", () => {
    const analysis = fixtureAnalysis({
      resources: { websites: [], tools: [], courses: [], books: [], repositories: [], people: [], companies: [] },
    });
    expect(formatResources(analysis)).toBe("");
  });
});

describe("formatFullAnalysis", () => {
  it("includes every populated section", () => {
    const text = formatFullAnalysis(fixtureContent(), fixtureAnalysis());
    expect(text).toContain("WHAT IS THIS?");
    expect(text).toContain("WHAT SHOULD I DO?");
    expect(text).toContain("WHAT DO I GET?");
    expect(text).toContain("KEY TAKEAWAYS");
    expect(text).toContain("RESOURCES");
    expect(text).toContain("TECHNOLOGIES");
    expect(text).toContain("ACTION ITEMS");
  });

  it("omits WHAT DO I GET when there's no CTA and nothing identified", () => {
    const analysis = fixtureAnalysis({
      cta: { detected: false, action: "none", keyword: null, instruction: null },
      whatUserGets: { identified: false, description: null },
    });
    const text = formatFullAnalysis(fixtureContent(), analysis);
    expect(text).not.toContain("WHAT DO I GET?");
  });

  it("says the resource isn't clear when CTA is detected but not identified", () => {
    const analysis = fixtureAnalysis({ whatUserGets: { identified: false, description: null } });
    const text = formatFullAnalysis(fixtureContent(), analysis);
    expect(text).toContain("isn't clear from the available content");
  });

  it("includes links found in the content", () => {
    const content = fixtureContent({ links: ["https://github.com/someuser"] });
    const text = formatFullAnalysis(content, fixtureAnalysis());
    expect(text).toContain("LINKS FOUND");
    expect(text).toContain("https://github.com/someuser");
  });
});

function link(overrides: Partial<LinkResult> = {}): LinkResult {
  return { title: "Excalidraw", url: "https://excalidraw.com", source: "excalidraw.com", reason: "match", confidence: "high", ...overrides };
}

function fixturePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    reel: { url: "https://www.instagram.com/reel/abc/", creator: "someuser", captionPreview: "caption", reelType: "recommendation_list", topic: null },
    creatorPromise: null,
    results: [{ pointerId: "p1", kind: "explicit", resourceType: "web_tool", name: "Excalidraw", links: [link()] }],
    creatorOwned: [],
    explore: null,
    unresolved: [],
    evidencePanel: { caption: "caption", transcriptSnippets: [], onScreenText: [], comments: [] },
    warnings: [],
    ingestion: { status: "manual_only", missing: [] },
    ...overrides,
  };
}

describe("formatLinks", () => {
  it("formats a title+url bullet list", () => {
    expect(formatLinks([link(), link({ title: "GitHub", url: "https://github.com/x" })])).toBe(
      "- Excalidraw: https://excalidraw.com\n- GitHub: https://github.com/x",
    );
  });
});

describe("formatAllLinks", () => {
  it("includes pointer results, creator-owned alternatives, and explore links", () => {
    const result = fixturePipelineResult({
      creatorOwned: [{ name: "my PDF", note: "gated", alternatives: [link({ title: "Alt", url: "https://alt.com" })] }],
      explore: [link({ title: "Related", url: "https://related.com" })],
    });
    const text = formatAllLinks(result);
    expect(text).toContain("https://excalidraw.com");
    expect(text).toContain("https://alt.com");
    expect(text).toContain("https://related.com");
  });

  it("skips creator-owned entries with no alternatives", () => {
    const result = fixturePipelineResult({
      results: [],
      creatorOwned: [{ name: "my PDF", note: "gated", alternatives: [] }],
    });
    expect(formatAllLinks(result)).toBe("");
  });
});
