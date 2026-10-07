// A reel can have up to 8 pointers, each matched to 1-3 resolvers — without
// a cap that's dozens of simultaneous requests to third-party APIs (some of
// which, like Nominatim, have strict per-second policies). This is a simple,
// global cap across the whole fan-out, not a per-API-tuned rate limiter —
// adequate for this MVP stage, not a precision instrument.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
