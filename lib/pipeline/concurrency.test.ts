import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/pipeline/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in the results regardless of completion order", async () => {
    const delays = [30, 10, 20, 5];
    const results = await mapWithConcurrency(delays, 4, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));
    expect(results).toEqual(delays);
  });

  it("never runs more than `limit` items concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("handles an empty input array", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
  });

  it("handles a limit larger than the input size", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (x) => x * 2);
    expect(results).toEqual([2, 4]);
  });
});
