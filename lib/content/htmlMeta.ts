const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&apos;": "'",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&amp;|&lt;|&gt;|&quot;|&#039;|&apos;/g, (m) => ENTITY_MAP[m] ?? m);
}

export function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propFirst = new RegExp(
    `<meta[^>]*?(?:property|name)=["']${escaped}["'][^>]*?content=["']([^"']*)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${escaped}["']`,
    "i",
  );
  const match = html.match(propFirst) ?? html.match(contentFirst);
  return match ? decodeHtmlEntities(match[1]).trim() || null : null;
}

const URL_RE = /https?:\/\/[^\s"'<>]+/g;

export function isSafeImageUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function extractUrls(text: string | null): string[] {
  if (!text) return [];
  const found = text.match(URL_RE) ?? [];
  return Array.from(new Set(found.map((u) => u.replace(/[),.]+$/, ""))));
}

// Instagram's og:description is usually "12K likes, 340 comments - user on <date>: "caption"" — pull the quoted part out.
export function extractCaptionFromDescription(description: string | null): string | null {
  if (!description) return null;
  const quoted = description.match(/:\s*"([\s\S]+)"\s*$/);
  if (quoted) return quoted[1].trim() || null;
  return description.trim() || null;
}

export function extractUsernameFromDescription(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/-\s*([a-zA-Z0-9._]+)\s+on\s+/);
  return match ? match[1] : null;
}
