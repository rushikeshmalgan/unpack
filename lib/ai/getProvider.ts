import type { AIProvider } from "@/lib/ai/types";
import { geminiProvider } from "@/lib/ai/geminiProvider";
import { FallbackAIProvider } from "@/lib/ai/fallbackProvider";

// Claude/OpenAI aren't implemented yet (see Phase 3 notes) — the registry
// and AI_FALLBACK_PROVIDER wiring below is ready for them, but selecting an
// unregistered name just means "no fallback configured", not a crash.
const PROVIDER_REGISTRY: Partial<Record<string, AIProvider>> = {
  gemini: geminiProvider,
};

export const KNOWN_AI_PROVIDERS = Object.keys(PROVIDER_REGISTRY);

function resolveProvider(name: string | undefined): AIProvider | undefined {
  if (!name) return undefined;
  return PROVIDER_REGISTRY[name.toLowerCase()];
}

let cached: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  const primary = resolveProvider(process.env.AI_PROVIDER) ?? geminiProvider;
  const fallback = resolveProvider(process.env.AI_FALLBACK_PROVIDER);

  cached =
    fallback && fallback !== primary
      ? new FallbackAIProvider(primary, fallback, process.env.AI_FALLBACK_ON_QUOTA === "true")
      : primary;

  return cached;
}
