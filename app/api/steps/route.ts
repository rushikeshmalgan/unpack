import { NextRequest, NextResponse } from "next/server";
import { stepsRequestSchema } from "@/lib/schemas/utilityRequests";
import { enforceRateLimit } from "@/lib/rateLimit/enforce";
import { getAIProvider } from "@/lib/ai/getProvider";
import { toApiError } from "@/lib/ai/providerError";
import { isBodyTooLarge } from "@/lib/requestGuard";

export const runtime = "nodejs";
// See app/api/analyze/route.ts for the worst-case timing this bounds.
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

  const parsed = stepsRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "bad_request", message: "Invalid request." } },
      { status: 400 },
    );
  }

  try {
    const outcome = await getAIProvider().turnIntoSteps(parsed.data);

    if (!outcome.ok) {
      console.error("[api/steps] AI steps failed:", outcome.error.type);
      return NextResponse.json({ success: false, error: toApiError(outcome.error) }, { status: 502 });
    }

    return NextResponse.json({ success: true, steps: outcome.data.steps });
  } catch (err) {
    console.error("[api/steps] unexpected error:", err);
    return NextResponse.json(
      { success: false, error: { code: "server_error", message: "Something went wrong. Please try again." } },
      { status: 500 },
    );
  }
}
