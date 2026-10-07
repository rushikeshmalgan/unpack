// Tier 1 of ingestion (see ingestReel.ts): a pluggable, self-hosted extractor
// for transcript/OCR/on-screen-text. We don't run yt-dlp or any video
// download ourselves — that's a separate hosting decision for whoever
// operates this app. Point EXTRACTOR_API_URL at your own service (REST, POST
// {url} -> the shape below) to activate this tier; otherwise ingestion falls
// through cleanly to oEmbed/metadata + manual fallback.

export interface ExtractorResult {
  caption: string | null;
  transcript: string | null;
  onScreenText: string | null;
  comments: string | null;
  creatorUsername: string | null;
  thumbnailUrl: string | null;
}

export type ExtractorOutcome =
  | { ok: true; data: ExtractorResult }
  | { ok: false; reason: "not_configured" | "unreachable" | "timeout" | "invalid_response" };

const TIMEOUT_MS = 20_000;

export async function callExtractor(url: string): Promise<ExtractorOutcome> {
  const extractorUrl = process.env.EXTRACTOR_API_URL;
  if (!extractorUrl) {
    return { ok: false, reason: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.EXTRACTOR_API_KEY) {
      headers.Authorization = `Bearer ${process.env.EXTRACTOR_API_KEY}`;
    }

    const response = await fetch(extractorUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "unreachable" };
    }

    const body = (await response.json()) as Partial<ExtractorResult>;
    if (typeof body !== "object" || body === null) {
      return { ok: false, reason: "invalid_response" };
    }

    return {
      ok: true,
      data: {
        caption: body.caption ?? null,
        transcript: body.transcript ?? null,
        onScreenText: body.onScreenText ?? null,
        comments: body.comments ?? null,
        creatorUsername: body.creatorUsername ?? null,
        thumbnailUrl: body.thumbnailUrl ?? null,
      },
    };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
