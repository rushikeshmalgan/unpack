import { ApiError } from "@google/genai";
import { providerError, type AIProviderError } from "@/lib/ai/providerError";

interface ParsedGeminiBody {
  status?: string; // e.g. "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INVALID_ARGUMENT"
  message?: string;
  quotaId?: string;
}

function parseBody(err: ApiError): ParsedGeminiBody {
  try {
    const parsed = JSON.parse(err.message) as {
      error?: { status?: string; message?: string; details?: unknown[] };
    };
    const body = parsed.error ?? {};
    const quotaDetail = body.details?.find(
      (d): d is { violations?: { quotaId?: string }[] } =>
        typeof d === "object" && d !== null && "violations" in d,
    );
    const quotaId = quotaDetail?.violations?.[0]?.quotaId;
    return { status: body.status, message: body.message, quotaId };
  } catch {
    return {};
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// 5xx that are worth one quick retry — distinct from 429, which is never
// retried immediately regardless of sub-type (see providerError.ts).
export const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

export function classifyGeminiError(err: unknown): AIProviderError {
  if (isAbortError(err)) {
    return providerError("TIMEOUT");
  }

  if (!(err instanceof ApiError)) {
    return providerError("UNKNOWN");
  }

  const body = parseBody(err);

  if (err.status === 429) {
    const isDailyQuota = body.quotaId?.toLowerCase().includes("day") ?? false;
    return providerError(isDailyQuota ? "QUOTA_EXCEEDED" : "RATE_LIMIT");
  }

  if (err.status === 401 || err.status === 403) {
    return providerError("AUTHENTICATION");
  }

  if (err.status === 400 && /api[ _]?key/i.test(body.message ?? "")) {
    return providerError("AUTHENTICATION");
  }

  if (TRANSIENT_STATUSES.has(err.status)) {
    return providerError("PROVIDER_UNAVAILABLE");
  }

  return providerError("UNKNOWN");
}

// Only these two in-process-retryable types get an immediate, single retry.
// RATE_LIMIT is deliberately excluded even though providerError() marks it
// .retryable (that flag means "worth trying later / eligible for fallback",
// not "worth retrying in the next 500ms").
export function isImmediatelyRetryable(error: AIProviderError): boolean {
  return error.type === "TIMEOUT" || error.type === "PROVIDER_UNAVAILABLE";
}
