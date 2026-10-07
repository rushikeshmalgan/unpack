import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { classifyGeminiError, isImmediatelyRetryable } from "@/lib/ai/geminiErrorClassifier";

function dailyQuotaError() {
  return new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "You exceeded your current quota, please check your plan and billing details.",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
          },
        ],
      },
    }),
  });
}

function shortBurstRateLimitError() {
  return new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Too many requests per minute.",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerMinutePerProject" }],
          },
        ],
      },
    }),
  });
}

function unavailableError() {
  return new ApiError({
    status: 503,
    message: JSON.stringify({
      error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." },
    }),
  });
}

function invalidApiKeyError() {
  return new ApiError({
    status: 400,
    message: JSON.stringify({
      error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." },
    }),
  });
}

function permissionDeniedError() {
  return new ApiError({
    status: 403,
    message: JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Permission denied." } }),
  });
}

function unknownBadRequestError() {
  return new ApiError({
    status: 400,
    message: JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Malformed request." } }),
  });
}

describe("classifyGeminiError", () => {
  it("classifies daily quota exhaustion as QUOTA_EXCEEDED, not retryable", () => {
    const result = classifyGeminiError(dailyQuotaError());
    expect(result.type).toBe("QUOTA_EXCEEDED");
    expect(result.retryable).toBe(false);
    expect(isImmediatelyRetryable(result)).toBe(false);
  });

  it("classifies a non-daily 429 as RATE_LIMIT", () => {
    const result = classifyGeminiError(shortBurstRateLimitError());
    expect(result.type).toBe("RATE_LIMIT");
    // retryable=true (fallback-eligible) but NOT immediately retried in-process
    expect(result.retryable).toBe(true);
    expect(isImmediatelyRetryable(result)).toBe(false);
  });

  it("classifies 503 as PROVIDER_UNAVAILABLE and immediately retryable", () => {
    const result = classifyGeminiError(unavailableError());
    expect(result.type).toBe("PROVIDER_UNAVAILABLE");
    expect(isImmediatelyRetryable(result)).toBe(true);
  });

  it("classifies an invalid API key (400) as AUTHENTICATION", () => {
    const result = classifyGeminiError(invalidApiKeyError());
    expect(result.type).toBe("AUTHENTICATION");
    expect(result.retryable).toBe(false);
  });

  it("classifies 403 PERMISSION_DENIED as AUTHENTICATION", () => {
    const result = classifyGeminiError(permissionDeniedError());
    expect(result.type).toBe("AUTHENTICATION");
  });

  it("classifies an unrecognized 400 as UNKNOWN", () => {
    const result = classifyGeminiError(unknownBadRequestError());
    expect(result.type).toBe("UNKNOWN");
    expect(result.retryable).toBe(false);
  });

  it("classifies an AbortError as TIMEOUT and immediately retryable", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    const result = classifyGeminiError(abort);
    expect(result.type).toBe("TIMEOUT");
    expect(isImmediatelyRetryable(result)).toBe(true);
  });

  it("classifies an arbitrary non-ApiError as UNKNOWN", () => {
    const result = classifyGeminiError(new Error("something else"));
    expect(result.type).toBe("UNKNOWN");
  });

  it("never exposes API keys or raw provider messages to the user-facing message", () => {
    const result = classifyGeminiError(invalidApiKeyError());
    expect(result.message.toLowerCase()).not.toContain("api key");
    expect(result.message.toLowerCase()).not.toContain("gemini");
  });
});
