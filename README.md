This is a [Next.js](https://nextjs.org) app: paste an Instagram Reel/Post link and get back the real, verified links it points to — videos, tools, GitHub repos, books, places, products, and more. No commenting, no following, no waiting for a DM. Stateless — nothing submitted is ever persisted server-side, no accounts, no database.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without a `.env` file, the app runs fully (homepage, validation, content retrieval) but the AI understanding step returns a graceful "not configured" error — copy `.env.example` to `.env` and set `GEMINI_API_KEY` to exercise the full flow locally. The in-memory rate limiter and local dev don't need Upstash. Every resolver API key is optional; the pipeline works with zero keys configured (see "Resolvers" below).

```bash
npm run test   # vitest — 200+ tests
npm run lint
npm run build
```

---

## Architecture: Reel → Resource Resolver

`POST /api/analyze` runs a single request through six stages, with no step persisting anything between requests:

```
 URL + optional manual paste
        │
        ▼
 ┌─────────────────┐  Stage A: ingest        lib/pipeline/ingest/ingestReel.ts
 │ 1. pluggable     │  3-tier fallback, each one optional:
 │    extractor     │  1) EXTRACTOR_API_URL (your own self-hosted service)
 │    (if EXTRACTOR_│  2) Instagram oEmbed/OG-tag metadata (existing,
 │    API_URL set)  │     allowlisted fetch — this app's only own retrieval)
 │ 2) oEmbed/OG tags│  3) whatever the user pastes manually (caption/
 │ 3) manual paste  │     transcript/on-screen text/comments)
 └────────┬─────────┘
          ▼
 ┌─────────────────┐  Stage B: understand     lib/pipeline/understand.ts
 │ Gemini, strict   │  Structured JSON output (Zod-validated): reelType,
 │ JSON schema      │  creatorPromise, ctaDetected, pointers[] (what the
 │ output           │  reel points to), topicIfNoPointers, searchPlans
 └────────┬─────────┘  prompts/understand.ts
          ▼
 ┌─────────────────┐  Stage C: resolve        lib/pipeline/resolvers/*
 │ registry routes  │  Each pointer's resourceType is matched against a
 │ each pointer to  │  Resolver (id, handles(), search()) via an open
 │ 1+ resolvers,    │  string registry — see "Adding a resolver" below.
 │ run in parallel  │  Concurrency-capped fan-out (lib/pipeline/concurrency.ts)
 │ (concurrency cap)│  to real third-party search APIs. No resolver match
 └────────┬─────────┘  → universal web-search fallback (if configured).
          ▼
 ┌─────────────────┐  Stage D: verify & rank  lib/pipeline/verify.ts
 │ dedupe → score   │  HARD RULE: every URL in the final output came from a
 │ → liveness check │  retrieval result. The LLM never generates a URL — a
 │ (HEAD request)   │  post-check (stripUnretrievedUrls) strips anything
 │ → rank → cap     │  that isn't in the retrieved candidate set, as
 └────────┬─────────┘  defense-in-depth on top of that being true by
          ▼            construction. Dead links (failed liveness) are
 ┌─────────────────┐  dropped before the user ever sees them.
 │ Stage E: assemble│  lib/pipeline/pipeline.ts (assembleResult)
 │ EXACT (default)  │  EXACT mode resolves only what's pointed to. EXPLORE
 │ vs EXPLORE mode  │  mode (toggle, or auto-triggered when a reel has no
 └────────┬─────────┘  pointers) adds topic-based suggestions, always in a
          ▼            separate, clearly labeled section — never merged
    Final JSON         silently into exact matches.
```

Caching (Stage C/pipeline-level, `lib/pipeline/cache.ts`): resolver search results and ingested-reel signals are cached in the same Upstash Redis instance used for rate limiting, keyed by resolver+query or by reel shortcode, with TTLs (1 day / 7 days). This is purely a cost/latency optimization, not a database of user content. The ingestion cache is shared across all users and keyed only by reel shortcode, so it holds **only automatically retrieved signals** (extractor / public metadata) — anything a user pastes is never read from or written to it, and "no signal" results are never cached (so a transient outage isn't remembered). The app runs correctly with the cache absent (every cache call is wrapped in try/catch and no-ops without Redis configured). "History of past lookups" in the UI is `localStorage` only and never reaches the server.

### Adding a resolver

A resolver is one file implementing the `Resolver` interface (`lib/pipeline/resolvers/types.ts`):

```ts
export interface Resolver {
  id: string;
  handles(resourceType: string): boolean;
  search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]>;
}
```

1. Create `lib/pipeline/resolvers/yourResolver.ts` — call a real search API, map its results to `Candidate[]` (never invent a URL).
2. Add it to the `RESOLVERS` array in `lib/pipeline/resolvers/registry.ts`, above `webSearchResolver` (which must stay last — it's the universal fallback).
3. If `resourceType` needs a new canonical token, add it to `KNOWN_RESOURCE_TYPES` in `lib/schemas/pipeline/understanding.ts` — this list is interpolated directly into the Stage B prompt (`prompts/understand.ts`) so the model knows the exact string to emit (see "Known limitations" — this match is exact-string, not fuzzy).
4. Make requests through `fetchSourceJson` / `fetchSourceText` (`lib/pipeline/resolvers/http.ts`) rather than raw `fetch`. They apply a timeout and call `ctx.reportIssue` when the source is rate-limited or down, which is how the pipeline tells "couldn't search" apart from "searched, found nothing" (and avoids caching the former). If the resolver needs a key, read it from `process.env`, call `ctx.reportIssue?.("… isn't enabled on this server")` and return `[]` when it's absent — never throw, never crash the whole pipeline over one missing key.
5. Optionally set `aliases` (other names the result is known by) and `popularity` (a raw count like stars, compared only within your source) on each `Candidate` to sharpen ranking.

That's the whole contract: the pipeline, registry routing, verification, ranking, and dedup are all resourceType-agnostic and require no changes.

### Resolvers in this repo

| Resolver | resourceType(s) | Needs a key? |
|---|---|---|
| GitHub | `github_repo`, `library_package` | No, but `GITHUB_TOKEN` is effectively required in production — unauthenticated search is 10 requests/minute per IP, which shared serverless egress exhausts |
| npm | `library_package` | No |
| Open Library | `book` | No |
| arXiv | `research_paper` | No |
| OpenStreetMap/Nominatim | `place`, `restaurant_or_cafe` | No |
| iTunes Search | `app_mobile` | No |
| YouTube Data API | `video`, `channel`, `playlist` | Yes — `YOUTUBE_API_KEY` |
| Tavily web search (universal fallback) | anything unmatched above | Yes — `TAVILY_API_KEY` |

A resolver that can't search — key missing, rate-limited, or the source is down — is skipped gracefully and never fails the request. When that leaves a pointer without any link, its "Couldn't find" row says which sources couldn't be searched ("Not found, and some sources couldn't be searched (GitHub search is rate-limited)"), so a rate limit is never presented as "this doesn't exist". Such failed lookups are also never cached, so a transient outage isn't remembered for the cache TTL.

---

## PRODUCTION DEPLOYMENT

This app is designed for Vercel (serverless Next.js, server-side AI calls, REST-based Redis) and needs no `vercel.json` — the build, routes, and `next.config.ts` headers are picked up automatically.

1. **Create Gemini API credentials** — generate a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. **Configure Gemini billing/quota** — the free tier is **20 requests/day per model** and will not survive real traffic (confirmed by exhausting it during development). Enable billing on the underlying Google Cloud project before pointing real users at this. The app defaults to `gemini-flash-lite-latest` (override via `GEMINI_MODEL`) — chosen for this workload's needs (extraction/structured JSON, not deep reasoning) and verified against our exact schema/prompt/parsing path before being made the default.
3. **Create an Upstash Redis database** — free tier is fine, see [console.upstash.com](https://console.upstash.com). Copy its REST URL and token (not the regular Redis connection string). Used for both rate limiting and the pipeline cache described above.
4. **Configure environment variables** in the Vercel project (Settings → Environment Variables, Production scope): `GEMINI_API_KEY`, `RATE_LIMIT_BACKEND`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, plus whichever optional resolver keys you want active (`GITHUB_TOKEN`, `YOUTUBE_API_KEY`, `TAVILY_API_KEY`) and `EXTRACTOR_API_URL`/`EXTRACTOR_API_KEY` if you're running your own extractor. See `.env.example` for the full reference.
5. **Set `RATE_LIMIT_BACKEND=redis`** — this is not optional for a real deployment. On a serverless platform, the in-memory fallback gives each invocation its own counter, which is effectively no rate limiting at all. If this is set to `redis` without both Upstash variables present, the app refuses to start (fails closed, not open).
6. **Deploy to Vercel** — connect the repo, no custom build settings needed.
7. **Verify the production build** succeeded and the deployment is live (check the Vercel deployment logs for the `[startup]` validation line — it should log nothing if everything's configured, or throw a clear, secret-free error naming exactly which variable is missing).
8. **Run the smoke tests** below against the live URL.
9. **Verify rate limiting**: 12 requests in under 60s against `/api/analyze` from the same IP; the 13th should 429.
10. **Verify the pipeline end-to-end**: submit a Reel URL with a pasted caption mentioning something keyless-resolvable (e.g. "check out the react github repo") and confirm real links come back with correct routing (not everything falling into "unresolved").

Never put real secret values in this file, in `.env.example`, in client components, or in a `NEXT_PUBLIC_*` variable — all API keys are read only by server-side modules under `lib/`.

### Instagram ToS and scraping risk

This app does not implement or bundle an Instagram scraper. Instagram has no official API for reel video, audio, or on-screen text, and building one against Instagram's private endpoints would violate Meta's Terms of Service. Stage A ingestion is therefore a 3-tier fallback, in priority order:

1. **`EXTRACTOR_API_URL`** — an optional, pluggable, self-hosted or third-party extraction service you run and are legally responsible for operating within Instagram's ToS (or under a license/agreement that permits it). This app only calls it over HTTP with a timeout; it does not implement, host, or endorse any particular extractor.
2. **oEmbed/Open Graph metadata** — Instagram's own public, unauthenticated metadata for a post (title/description/thumbnail). This is the only retrieval this app performs itself, through an allowlisted fetch restricted to Instagram's own domains.
3. **Manual paste** — the user pastes the caption/transcript/on-screen text/comments themselves.

If no extractor is configured and the metadata fallback doesn't yield enough signal, the app asks the user to paste what it's missing rather than guessing or scraping further.

### Cost control, by design

- **Max 3 Gemini calls per `/api/analyze` request** (Stage B understanding) — 1 initial attempt, 1 shared retry (only for timeouts/5xx), 1 schema-repair attempt if the model's JSON didn't validate (which cannot itself retry — the budget is already spent). Typical case is 1 call; quota exhaustion and invalid-API-key failures never retry at all.
- **Resolver search results and ingested signals are cached** (see Architecture above) so repeat lookups of the same reel or search query don't re-spend AI/API quota.
- **Ranking is deterministic, not an LLM call.** Stage D scores candidates by name/token overlap plus an official-source-domain boost — no extra Gemini call per pointer. This keeps AI cost bounded regardless of how many pointers a reel has, at the cost of ranking being a heuristic rather than a judgment call; see "Known limitations."
- **Rate limiting** (12 requests/60s by IP) is the primary abuse control, since there's no authentication.

---

## Known limitations

- **Ranking is deterministic (token-overlap + official-domain heuristics), not LLM-judged.** The original spec described the LLM as a judge over candidates; this was scoped down to a non-AI heuristic to keep per-request AI cost bounded and latency predictable (see "Cost control" above). It works well for clearly-named pointers (repos, books, packages) and less precisely for ambiguous or very generic names.
- **Gemini's `responseJsonSchema` enforces an undocumented complexity limit.** A schema whose array `maxItems` × nested-object complexity crosses some internal threshold is rejected with a bare `400 INVALID_ARGUMENT` (no field-level detail) — empirically found while building Stage B (see `lib/schemas/pipeline/understanding.ts`). `pointers`/`searchPlans` are capped at 8 items and `evidence` at 3, verified safe; raising these caps without re-testing against the live API risks silently breaking every request.
- **`resourceType` routing is an exact string match**, not fuzzy. The Stage B prompt now explicitly lists every canonical token so the model uses them verbatim (fixed after an end-to-end test showed pointers routing to the wrong resolver because the model had paraphrased e.g. "GitHub Repository" instead of `github_repo`) — but a model update or an unusual reel could still produce an unlisted token, which falls through to the web-search resolver (or "unresolved" if that's unconfigured).
- **No PyPI resolver.** PyPI has no JSON search API (`pypi.org/search/` is HTML-only; the JSON endpoint only does exact-name lookup). Python packages route through the web-search fallback with a `site:pypi.org` query hint instead of a dedicated resolver.
- **No Semantic Scholar resolver.** Live-tested during development and found to 429 on a single unauthenticated request — too unreliable keyless to depend on. Academic papers rely solely on arXiv.
- **Third-party search APIs (Open Library, Nominatim, etc.) are occasionally slow or briefly unavailable**, same as any external dependency. The pipeline treats this as "unresolved" with a manual-search link, not an error — by design, never a hallucinated guess.
- **`/api/explain` and `/api/steps` are orphaned from the previous product** (the reel-summarizer this app used to be) and are no longer called by the current UI, which only talks to `/api/analyze`. They still work and are still tested, but are not part of the resource-finder flow — worth removing in a follow-up if they won't be reused.
- **Only `gemini` is an implemented AI provider.** `AI_FALLBACK_PROVIDER` is a documented no-op until a second provider exists.

---

## PRODUCTION SMOKE TEST CHECKLIST

Run against the live deployment before calling it done:

1. [ ] Homepage loads
2. [ ] Invalid URL rejected (client + server)
3. [ ] Valid Instagram URL accepted
4. [ ] A reel with clearly-named resources (e.g. a tool list) returns real, correctly-typed links, not "unresolved"
5. [ ] A reel with no pointers (pure motivation) returns `topicIfNoPointers` and prompts toward Explore mode, not an empty/broken screen
6. [ ] A gated/"comment X" reel is marked creator-owned (if private) or resolved normally (if the gated item is actually public), never silently dropped
7. [ ] EXACT/EXPLORE toggle works and the two result sets are visually distinct, never merged
8. [ ] Copy buttons (single link, per-pointer, "copy all") work
9. [ ] Keyboard navigation reaches every interactive element, with visible focus rings
10. [ ] Mobile layout holds at 375px width
11. [ ] Rate limit triggers at the 13th request/min and resets after the window
12. [ ] A simulated Gemini quota/error degrades gracefully (clear message, no crash)
13. [ ] A retrieval failure (private/deleted post, no extractor configured) degrades gracefully, prompts for manual paste
14. [ ] SSRF bypass attempts against resolver-returned URLs (userinfo trick, metadata IP, localhost, private IP ranges) stay blocked — both the Instagram-only allowlist fetch and the general-purpose blocklist fetch
15. [ ] Security headers present on every response
16. [ ] No API key (Gemini, GitHub, YouTube, Tavily, Upstash) appears in any client-side bundle or response
17. [ ] No submitted URL/caption/transcript/resolved links are persisted server-side between requests (only the Redis cache, which is content-keyed, not user-keyed, and has a TTL)
18. [ ] Production build succeeds (`npm run build`)
19. [ ] Production logs contain no captions, transcripts, raw IPs, or secrets — only error types, routes, and status
20. [ ] No URL in a response is absent from that request's retrieved candidates (the no-hallucination rule) — spot-check against server logs if in doubt

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Upstash Redis](https://upstash.com/docs/redis)
