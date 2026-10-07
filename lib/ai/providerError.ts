// Provider-agnostic error shape. Everything downstream of an AIProvider (routes,
// UI, fallback logic) sees only this — never a raw Gemini/Claude/OpenAI error.
export type AIProviderErrorType =
  | "RATE_LIMIT"
  | "QUOTA_EXCEEDED"
  | "AUTHENTICATION"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export interface AIProviderError {
  type: AIProviderErrorType;
  // Whether this class of error is generally worth trying again (at all, by
  // anyone — us or a fallback provider), NOT an instruction to retry *now*.
  // The provider's own in-process retry loop is intentionally narrower than
  // this flag (see geminiProvider.ts) — immediate retries are only attempted
  // for TIMEOUT/PROVIDER_UNAVAILABLE, never for RATE_LIMIT, since Google's
  // suggested backoff for rate limits is usually too long to be worth an
  // in-request retry.
  retryable: boolean;
  // User-safe, provider-agnostic. Never mentions API keys, vendor names, or
  // internal infrastructure details.
  message: string;
}

const MESSAGES: Record<AIProviderErrorType, string> = {
  RATE_LIMIT: "AI analysis is receiving a high volume of requests right now. Please try again in a moment.",
  QUOTA_EXCEEDED:
    "AI analysis is temporarily unavailable because our AI provider has reached its usage limit. Please try again later.",
  AUTHENTICATION: "AI analysis isn't configured correctly on the server right now.",
  TIMEOUT: "The AI took too long to respond. Please try again.",
  INVALID_RESPONSE: "We couldn't structure the analysis properly. Please try again.",
  PROVIDER_UNAVAILABLE: "The AI service is unavailable right now. Please try again shortly.",
  UNKNOWN: "Something went wrong with AI analysis. Please try again.",
};

const RETRYABLE: Record<AIProviderErrorType, boolean> = {
  RATE_LIMIT: true,
  QUOTA_EXCEEDED: false,
  AUTHENTICATION: false,
  TIMEOUT: true,
  INVALID_RESPONSE: false,
  PROVIDER_UNAVAILABLE: true,
  UNKNOWN: false,
};

export function providerError(type: AIProviderErrorType): AIProviderError {
  return { type, retryable: RETRYABLE[type], message: MESSAGES[type] };
}

export function toApiError(error: AIProviderError): { code: string; message: string } {
  return { code: `ai_${error.type.toLowerCase()}`, message: error.message };
}
