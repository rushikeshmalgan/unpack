import { KNOWN_AI_PROVIDERS } from "@/lib/ai/getProvider";

// Runs once at server startup (see instrumentation.ts). Never logs secret
// *values* — only which variable names are missing or which mode is active.
export function validateEnvironment(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const problems: string[] = [];

  const aiProvider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  if (isProduction && aiProvider === "gemini" && !process.env.GEMINI_API_KEY) {
    problems.push("GEMINI_API_KEY is required in production when AI_PROVIDER is gemini (or unset).");
  }

  const rateLimitBackend = (process.env.RATE_LIMIT_BACKEND ?? "memory").toLowerCase();
  if (rateLimitBackend === "redis") {
    if (!process.env.UPSTASH_REDIS_REST_URL) {
      problems.push("UPSTASH_REDIS_REST_URL is required when RATE_LIMIT_BACKEND=redis.");
    }
    if (!process.env.UPSTASH_REDIS_REST_TOKEN) {
      problems.push("UPSTASH_REDIS_REST_TOKEN is required when RATE_LIMIT_BACKEND=redis.");
    }
  } else if (isProduction) {
    console.warn(
      '[startup] RATE_LIMIT_BACKEND is not set to "redis" in production. On a serverless/' +
        "multi-instance platform (e.g. Vercel), the in-memory limiter provides NO real protection " +
        "at all — each invocation can get its own fresh counter. Set RATE_LIMIT_BACKEND=redis with " +
        "UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN before serving real traffic.",
    );
  }

  const fallbackProvider = process.env.AI_FALLBACK_PROVIDER;
  if (fallbackProvider && !KNOWN_AI_PROVIDERS.includes(fallbackProvider.toLowerCase())) {
    console.warn(
      `[startup] AI_FALLBACK_PROVIDER="${fallbackProvider}" is not an implemented provider — fallback is disabled.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
  }
}
