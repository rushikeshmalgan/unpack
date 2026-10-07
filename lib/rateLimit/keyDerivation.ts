import { createHash } from "node:crypto";

export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

// We only need enough entropy to bucket requests per-IP for abuse
// prevention — not a security boundary, so an unsalted hash is fine. This
// keeps the literal IP from being stored verbatim in a third-party store.
export function rateLimitKey(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}
