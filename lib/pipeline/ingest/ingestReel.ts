import { validateInstagramUrl, describeUrlError } from "@/lib/validation";
import { instagramProvider } from "@/lib/content/instagramProvider";
import { callExtractor } from "@/lib/pipeline/ingest/extractorClient";
import { isSafeImageUrl } from "@/lib/content/htmlMeta";

export interface ManualFallbackInput {
  caption?: string;
  transcript?: string;
  comments?: string;
  onScreenText?: string;
  bioLink?: string;
}

export interface IngestedSignals {
  sourceUrl: string;
  contentType: "reel" | "post";
  creatorUsername: string | null;
  caption: string | null;
  transcript: string | null;
  onScreenText: string | null;
  comments: string | null;
  bioLink: string | null;
  thumbnailUrl: string | null;
  status: "full" | "partial" | "manual_only" | "none";
  missing: string[];
}

export type IngestOutcome = { ok: true; signals: IngestedSignals } | { ok: false; message: string };

export async function ingestReel(url: string, manual: ManualFallbackInput): Promise<IngestOutcome> {
  const validated = validateInstagramUrl(url);
  if (!validated.ok) {
    return { ok: false, message: describeUrlError(validated.reason) };
  }

  const extractor = await callExtractor(validated.normalizedUrl);
  const metadata = await instagramProvider.retrieve(validated.normalizedUrl);

  const manualCaption = manual.caption?.trim() || null;
  const manualTranscript = manual.transcript?.trim() || null;
  const manualComments = manual.comments?.trim() || null;
  const manualOnScreenText = manual.onScreenText?.trim() || null;
  const manualBioLink = manual.bioLink?.trim() || null;

  const extracted = extractor.ok ? extractor.data : null;

  const caption = manualCaption ?? extracted?.caption ?? (metadata.ok ? metadata.caption : null);
  const transcript = manualTranscript ?? extracted?.transcript ?? null;
  const onScreenText = manualOnScreenText ?? extracted?.onScreenText ?? null;
  const comments = manualComments ?? extracted?.comments ?? null;
  const bioLink = manualBioLink ?? null;
  const creatorUsername = extracted?.creatorUsername ?? (metadata.ok ? metadata.creatorUsername : null);
  const rawThumbnail = extracted?.thumbnailUrl ?? (metadata.ok ? metadata.imageUrl : null);
  const thumbnailUrl = isSafeImageUrl(rawThumbnail) ? rawThumbnail : null;

  const missing: string[] = [];
  if (!caption) missing.push("caption");
  if (!transcript) missing.push("transcript");
  if (!onScreenText) missing.push("on-screen text");
  if (!comments) missing.push("comments");

  const hasAnySignal = !!(caption || transcript || onScreenText || comments);
  const hasManual = !!(manualCaption || manualTranscript || manualComments || manualOnScreenText);

  let status: IngestedSignals["status"];
  if (extractor.ok) {
    status = transcript || onScreenText ? "full" : "partial";
  } else if (metadata.ok || hasManual) {
    status = hasAnySignal ? (hasManual && !metadata.ok ? "manual_only" : "partial") : "none";
  } else {
    status = hasAnySignal ? "manual_only" : "none";
  }

  return {
    ok: true,
    signals: {
      sourceUrl: validated.normalizedUrl,
      contentType: validated.contentType,
      creatorUsername,
      caption,
      transcript,
      onScreenText,
      comments,
      bioLink,
      thumbnailUrl,
      status,
      missing,
    },
  };
}
