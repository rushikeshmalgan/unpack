// Upper bound on request bodies, checked via Content-Length before we ever
// buffer/parse the body — Zod's per-field limits only kick in after
// request.json() has already read the whole thing into memory.
// Generous enough for the max url+caption+transcript lengths even if every
// character were a 4-byte UTF-8 sequence (~15,000 chars -> ~60KB worst case).
export const MAX_REQUEST_BODY_BYTES = 100_000;

export function isBodyTooLarge(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_REQUEST_BODY_BYTES;
}
