// Client- and server-shared validation for the paste-link flow.
// Kept deliberately small: this is the only gate before content retrieval.

export const MAX_URL_LENGTH = 2000;
export const MAX_CAPTION_LENGTH = 5000;
export const MAX_TRANSCRIPT_LENGTH = 8000;

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "instagr.am"]);
const SUPPORTED_PATH_TYPES = new Set(["reel", "reels", "p", "tv"]);

export type UrlValidationResult =
  | { ok: true; normalizedUrl: string; shortcode: string; contentType: "reel" | "post" }
  | { ok: false; reason: "empty" | "too_long" | "not_a_url" | "unsupported_host" | "unsupported_path" };

export function validateInstagramUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim();

  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "not_a_url" };
  }

  if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: "unsupported_host" };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const [type, shortcode] = segments;

  if (!type || !shortcode || !SUPPORTED_PATH_TYPES.has(type.toLowerCase())) {
    return { ok: false, reason: "unsupported_path" };
  }

  const contentType: "reel" | "post" = type.toLowerCase() === "p" ? "post" : "reel";
  const normalizedUrl = `https://www.instagram.com/${type.toLowerCase()}/${shortcode}/`;

  return { ok: true, normalizedUrl, shortcode, contentType };
}

export function describeUrlError(reason: Exclude<UrlValidationResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Paste an Instagram Reel or Post link to continue.";
    case "too_long":
      return "That link is too long to be a valid Instagram URL.";
    case "not_a_url":
      return "That doesn't look like a valid link. Paste a full URL, e.g. https://www.instagram.com/reel/...";
    case "unsupported_host":
      return "We only support Instagram links right now — not other sites.";
    case "unsupported_path":
      return "We can only analyze Reels and Posts right now — not profile pages or other links.";
  }
}
