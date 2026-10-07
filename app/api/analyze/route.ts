import { NextRequest, NextResponse } from "next/server";
import { analyzeRequestSchema } from "@/lib/schemas/analyzeRequest";
import { retrieveContent } from "@/lib/content/retrieveContent";
import { enforceRateLimit } from "@/lib/rateLimit/enforce";
import { getAIProvider } from "@/lib/ai/getProvider";
import { toApiError } from "@/lib/ai/providerError";
import { isBodyTooLarge } from "@/lib/requestGuard";

export const runtime = "nodejs";
// Worst case through generateStructured is ~45s (3 Gemini attempts x 15s each,
// see geminiProvider.ts). 60s gives headroom without relying on platform
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

  const parsed = analyzeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "bad_request", message: "Invalid request." } },
      { status: 400 },
    );
  }

  try {
    const outcome = await retrieveContent(parsed.data);

    if (outcome.status === "invalid_url") {
      return NextResponse.json(
        { success: false, error: { code: "invalid_url", message: outcome.message } },
        { status: 422 },
      );
    }

    if (!outcome.sufficient) {
      return NextResponse.json({
        success: true,
        content: outcome.content,
        sufficientContent: false,
        retrieval: outcome.retrieval,
        analysis: null,
        aiError: null,
      });
    }

    const aiOutcome = await getAIProvider().analyze(outcome.content);
    if (!aiOutcome.ok) {
      console.error("[api/analyze] AI analysis failed:", aiOutcome.error.type);
    }

    return NextResponse.json({
      success: true,
      content: outcome.content,
      sufficientContent: true,
      retrieval: outcome.retrieval,
      analysis: aiOutcome.ok ? aiOutcome.analysis : null,
      aiError: aiOutcome.ok ? null : toApiError(aiOutcome.error),
    });
  } catch (err) {
    console.error("[api/analyze] unexpected error:", err);
    return NextResponse.json(
      { success: false, error: { code: "server_error", message: "Something went wrong while analyzing that link. Please try again." } },
      { status: 500 },
    );
  }
}
