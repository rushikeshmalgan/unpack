import { NextRequest, NextResponse } from "next/server";
import { unpackRequestSchema } from "@/lib/schemas/pipeline/request";
import { runPipeline } from "@/lib/pipeline/pipeline";
import { enforceRateLimit } from "@/lib/rateLimit/enforce";
import { toApiError } from "@/lib/ai/providerError";
import { isBodyTooLarge } from "@/lib/requestGuard";

export const runtime = "nodejs";
// Worst case through generateStructured is ~45s (3 Gemini attempts x 15s each,
// see geminiProvider.ts), plus resolver fan-out (each capped at 8-10s, run
// with bounded concurrency). 60s gives headroom without relying on platform
// defaults we can't fully verify for every account configuration.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  if (isBodyTooLarge(request)) {
    return NextResponse.json(
      { success: false, error: { code: "payload_too_large", message: "Request body is too large." } },
      { status: 413 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "bad_request", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = unpackRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "bad_request", message: "Invalid request." } },
      { status: 400 },
    );
  }

  try {
    const outcome = await runPipeline({
      url: parsed.data.url,
      manual: {
        caption: parsed.data.caption,
        transcript: parsed.data.transcript,
        comments: parsed.data.comments,
        onScreenText: parsed.data.onScreenText,
        bioLink: parsed.data.bioLink,
      },
      mode: parsed.data.mode,
      locale: parsed.data.locale,
    });

    if (outcome.status === "invalid_url") {
      return NextResponse.json(
        { success: false, error: { code: "invalid_url", message: outcome.message } },
        { status: 422 },
      );
    }

    if (outcome.status === "insufficient") {
      return NextResponse.json({
        success: true,
        status: "insufficient",
        ingestion: { status: outcome.signals.status, missing: outcome.signals.missing },
      });
    }

    if (outcome.status === "ai_error") {
      console.error("[api/analyze] AI understanding failed:", outcome.error.type);
      return NextResponse.json({
        success: true,
        status: "ai_error",
        error: toApiError(outcome.error),
        evidencePanel: {
          caption: outcome.signals.caption,
          transcriptSnippets: outcome.signals.transcript ? [outcome.signals.transcript.slice(0, 500)] : [],
          onScreenText: outcome.signals.onScreenText ? [outcome.signals.onScreenText.slice(0, 500)] : [],
          comments: outcome.signals.comments ? [outcome.signals.comments.slice(0, 500)] : [],
        },
      });
    }

    return NextResponse.json({ success: true, status: "ok", result: outcome.result });
  } catch (err) {
    console.error("[api/analyze] unexpected error:", err);
    return NextResponse.json(
      { success: false, error: { code: "server_error", message: "Something went wrong while analyzing that link. Please try again." } },
      { status: 500 },
    );
  }
}
