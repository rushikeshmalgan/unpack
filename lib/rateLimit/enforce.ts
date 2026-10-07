import { NextResponse } from "next/server";
import { getRateLimiter } from "@/lib/rateLimit/getRateLimiter";
import { clientIpFromHeaders, rateLimitKey } from "@/lib/rateLimit/keyDerivation";

// Shared across /api/analyze, /api/explain, /api/steps via one key per IP —
// an attacker can't dodge the 12/min cap by spreading requests across routes.
export async function enforceRateLimit(request: Request): Promise<NextResponse | null> {
  const ip = clientIpFromHeaders(request.headers);
  const key = rateLimitKey(ip);
  const result = await getRateLimiter().check(key);

  if (result.allowed) return null;

  console.warn("[rateLimit] request rejected: limit exceeded");
  return NextResponse.json(
    {
      success: false,
      error: { code: "rate_limited", message: "Too many requests. Please wait a moment and try again." },
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
