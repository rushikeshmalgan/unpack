import { describe, expect, it } from "vitest";
import { MAX_REQUEST_BODY_BYTES, isBodyTooLarge } from "@/lib/requestGuard";

function requestWithContentLength(length?: string): Request {
  const headers = new Headers();
  if (length !== undefined) headers.set("content-length", length);
  return new Request("http://localhost/api/analyze", { method: "POST", headers });
}

describe("isBodyTooLarge", () => {
  it("allows a request with no Content-Length header", () => {
    expect(isBodyTooLarge(requestWithContentLength())).toBe(false);
  });

  it("allows a request under the limit", () => {
    expect(isBodyTooLarge(requestWithContentLength(String(MAX_REQUEST_BODY_BYTES - 1)))).toBe(false);
  });

  it("allows a request exactly at the limit", () => {
    expect(isBodyTooLarge(requestWithContentLength(String(MAX_REQUEST_BODY_BYTES)))).toBe(false);
  });

  it("rejects a request over the limit", () => {
    expect(isBodyTooLarge(requestWithContentLength(String(MAX_REQUEST_BODY_BYTES + 1)))).toBe(true);
  });

  it("allows a request with a non-numeric Content-Length rather than crashing", () => {
    expect(isBodyTooLarge(requestWithContentLength("not-a-number"))).toBe(false);
  });
});
