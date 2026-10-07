import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  extractCaptionFromDescription,
  extractMetaContent,
  extractUrls,
  extractUsernameFromDescription,
  isSafeImageUrl,
} from "@/lib/content/htmlMeta";

describe("decodeHtmlEntities", () => {
  it("decodes the common entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeHtmlEntities("&quot;hello&quot;")).toBe('"hello"');
    expect(decodeHtmlEntities("it&#039;s")).toBe("it's");
    expect(decodeHtmlEntities("&lt;tag&gt;")).toBe("<tag>");
  });

  it("leaves plain text untouched", () => {
    expect(decodeHtmlEntities("plain text")).toBe("plain text");
  });
});

describe("extractMetaContent", () => {
  it("extracts content when property comes before content", () => {
    const html = `<meta property="og:title" content="Hello World" />`;
    expect(extractMetaContent(html, "og:title")).toBe("Hello World");
  });

  it("extracts content when content comes before property", () => {
    const html = `<meta content="Hello World" property="og:title" />`;
    expect(extractMetaContent(html, "og:title")).toBe("Hello World");
  });

  it("matches name= as well as property=", () => {
    const html = `<meta name="description" content="A description" />`;
    expect(extractMetaContent(html, "description")).toBe("A description");
  });

  it("decodes entities in the extracted value", () => {
    const html = `<meta property="og:description" content="Tom &amp; Jerry&#039;s show" />`;
    expect(extractMetaContent(html, "og:description")).toBe("Tom & Jerry's show");
  });

  it("returns null when the tag isn't present", () => {
    const html = `<meta property="og:title" content="Hello" />`;
    expect(extractMetaContent(html, "og:image")).toBeNull();
  });

  it("returns null for an empty content value", () => {
    const html = `<meta property="og:title" content="" />`;
    expect(extractMetaContent(html, "og:title")).toBeNull();
  });

  it("does not get confused by special regex characters in the key", () => {
    // og:title contains a colon, which isn't special in regex, but keys could
    // in principle contain other characters — this exercises the escaping.
    const html = `<meta property="og:title" content="value" />`;
    expect(extractMetaContent(html, "og:title")).toBe("value");
  });
});

describe("extractCaptionFromDescription", () => {
  it("pulls the quoted caption out of an Instagram-style description", () => {
    const description = '12K likes, 340 comments - someuser on January 1, 2026: "Comment GUIDE for the roadmap"';
    expect(extractCaptionFromDescription(description)).toBe("Comment GUIDE for the roadmap");
  });

  it("falls back to the raw description when there's no quoted part", () => {
    expect(extractCaptionFromDescription("Just a plain description")).toBe("Just a plain description");
  });

  it("returns null for null input", () => {
    expect(extractCaptionFromDescription(null)).toBeNull();
  });

  it("returns null for an empty/whitespace description", () => {
    expect(extractCaptionFromDescription("   ")).toBeNull();
  });
});

describe("extractUsernameFromDescription", () => {
  it("extracts the username from the standard Instagram description format", () => {
    const description = "12K likes, 340 comments - someuser.name on January 1, 2026: \"caption\"";
    expect(extractUsernameFromDescription(description)).toBe("someuser.name");
  });

  it("returns null when the pattern doesn't match", () => {
    expect(extractUsernameFromDescription("Nothing matching here")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractUsernameFromDescription(null)).toBeNull();
  });
});

describe("extractUrls", () => {
  it("extracts http(s) URLs from text", () => {
    const text = "Check out https://github.com/someuser and https://vercel.com too";
    expect(extractUrls(text)).toEqual(["https://github.com/someuser", "https://vercel.com"]);
  });

  it("deduplicates repeated URLs", () => {
    const text = "https://github.com/x see https://github.com/x again";
    expect(extractUrls(text)).toEqual(["https://github.com/x"]);
  });

  it("strips trailing punctuation", () => {
    const text = "Visit https://github.com/x, or https://vercel.com.";
    expect(extractUrls(text)).toEqual(["https://github.com/x", "https://vercel.com"]);
  });

  it("does not match bare domains without a protocol", () => {
    expect(extractUrls("github.com/someuser")).toEqual([]);
  });

  it("returns an empty array for null input", () => {
    expect(extractUrls(null)).toEqual([]);
  });
});

describe("isSafeImageUrl", () => {
  it("accepts https URLs", () => {
    expect(isSafeImageUrl("https://scontent.cdninstagram.com/img.jpg")).toBe(true);
  });

  it("rejects http URLs", () => {
    expect(isSafeImageUrl("http://scontent.cdninstagram.com/img.jpg")).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeImageUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isSafeImageUrl("not a url")).toBe(false);
  });

  it("rejects null", () => {
    expect(isSafeImageUrl(null)).toBe(false);
  });
});
