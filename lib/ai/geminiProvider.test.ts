import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";

const generateContentMock = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function MockGoogleGenAI() {
      return { models: { generateContent: generateContentMock } };
    }),
  };
});

// Imported after the mock so geminiProvider picks up the mocked GoogleGenAI.
const { geminiProvider } = await import("@/lib/ai/geminiProvider");

function abortError() {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

function unavailableError() {
  return new ApiError({
    status: 503,
    message: JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "High demand." } }),
  });
}

function dailyQuotaError() {
  return new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded.",
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

const VALID_STEPS_JSON = JSON.stringify({ steps: ["Step one", "Step two"] });
const INVALID_STEPS_JSON = JSON.stringify({ wrong_field: 123 });

beforeEach(() => {
  generateContentMock.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("model selection", () => {
  it("defaults to gemini-flash-lite-latest when GEMINI_MODEL isn't set", async () => {
    generateContentMock.mockResolvedValueOnce({ text: VALID_STEPS_JSON });

    await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-flash-lite-latest" }),
    );
  });

  it("uses GEMINI_MODEL when explicitly configured", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-flash-latest");
    generateContentMock.mockResolvedValueOnce({ text: VALID_STEPS_JSON });

    await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-flash-latest" }),
    );
  });

  it("falls back to the default when GEMINI_MODEL is set to an empty string", async () => {
    vi.stubEnv("GEMINI_MODEL", "   ");
    generateContentMock.mockResolvedValueOnce({ text: VALID_STEPS_JSON });

    await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-flash-lite-latest" }),
    );
  });
});

describe("geminiProvider.turnIntoSteps", () => {
  it("returns structured data on a clean success", async () => {
    generateContentMock.mockResolvedValueOnce({ text: VALID_STEPS_JSON });

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data.steps).toEqual(["Step one", "Step two"]);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider at all when no API key is configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.type).toBe("AUTHENTICATION");
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("does NOT retry on daily quota exhaustion", async () => {
    generateContentMock.mockRejectedValueOnce(dailyQuotaError());

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.type).toBe("QUOTA_EXCEEDED");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a timeout and succeeds on the second attempt", async () => {
    generateContentMock.mockRejectedValueOnce(abortError());
    generateContentMock.mockResolvedValueOnce({ text: VALID_STEPS_JSON });

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(true);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a temporary 5xx and gives up after the retry also fails", async () => {
    generateContentMock.mockRejectedValueOnce(unavailableError());
    generateContentMock.mockRejectedValueOnce(unavailableError());

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.type).toBe("PROVIDER_UNAVAILABLE");
    // Exactly one retry — not more — even though the retry also failed.
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("attempts a schema-repair pass on malformed output, then reports INVALID_RESPONSE if still bad", async () => {
    generateContentMock.mockResolvedValueOnce({ text: INVALID_STEPS_JSON });
    generateContentMock.mockResolvedValueOnce({ text: INVALID_STEPS_JSON });

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.type).toBe("INVALID_RESPONSE");
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("recovers via the schema-repair pass when the second attempt is valid", async () => {
    generateContentMock.mockResolvedValueOnce({ text: INVALID_STEPS_JSON });
    generateContentMock.mockResolvedValueOnce({ text: VALID_STEPS_JSON });

    const outcome = await geminiProvider.turnIntoSteps({ summary: "Build a thing." });

    expect(outcome.ok).toBe(true);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
