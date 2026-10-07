import { describe, expect, it, vi } from "vitest";
import { FallbackAIProvider } from "@/lib/ai/fallbackProvider";
import { providerError } from "@/lib/ai/providerError";
import type { AIProvider } from "@/lib/ai/types";

function fakeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    analyze: vi.fn(),
    explainSimply: vi.fn(),
    turnIntoSteps: vi.fn(),
    ...overrides,
  };
}

describe("FallbackAIProvider", () => {
  it("returns the primary's result directly on success, never touching fallback", async () => {
    const primary = fakeProvider({
      turnIntoSteps: vi.fn().mockResolvedValue({ ok: true, data: { steps: ["a"] } }),
    });
    const fallback = fakeProvider();
    const provider = new FallbackAIProvider(primary, fallback, false);

    const result = await provider.turnIntoSteps({ summary: "x" });

    expect(result.ok).toBe(true);
    expect(fallback.turnIntoSteps).not.toHaveBeenCalled();
  });

  it("falls back to the secondary provider on PROVIDER_UNAVAILABLE", async () => {
    const primary = fakeProvider({
      turnIntoSteps: vi.fn().mockResolvedValue({ ok: false, error: providerError("PROVIDER_UNAVAILABLE") }),
    });
    const fallback = fakeProvider({
      turnIntoSteps: vi.fn().mockResolvedValue({ ok: true, data: { steps: ["from fallback"] } }),
    });
    const provider = new FallbackAIProvider(primary, fallback, false);

    const result = await provider.turnIntoSteps({ summary: "x" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.steps).toEqual(["from fallback"]);
    expect(fallback.turnIntoSteps).toHaveBeenCalledTimes(1);
  });

  it("does NOT fall back on QUOTA_EXCEEDED unless explicitly opted in", async () => {
    const primary = fakeProvider({
      analyze: vi.fn().mockResolvedValue({ ok: false, error: providerError("QUOTA_EXCEEDED") }),
    });
    const fallback = fakeProvider();
    const provider = new FallbackAIProvider(primary, fallback, false);

    const result = await provider.analyze({} as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("QUOTA_EXCEEDED");
    expect(fallback.analyze).not.toHaveBeenCalled();
  });

  it("DOES fall back on QUOTA_EXCEEDED when fallbackOnQuota is true", async () => {
    const primary = fakeProvider({
      analyze: vi.fn().mockResolvedValue({ ok: false, error: providerError("QUOTA_EXCEEDED") }),
    });
    const fallback = fakeProvider({
      analyze: vi.fn().mockResolvedValue({ ok: true, analysis: {} as never }),
    });
    const provider = new FallbackAIProvider(primary, fallback, true);

    const result = await provider.analyze({} as never);

    expect(result.ok).toBe(true);
    expect(fallback.analyze).toHaveBeenCalledTimes(1);
  });
});
