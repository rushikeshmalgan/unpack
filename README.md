This is a [Next.js](https://nextjs.org) app: paste an Instagram Reel/Post link, get back what it's about, what the creator is asking you to do, and what you're supposed to get in return. Stateless — nothing submitted is ever persisted, no accounts, no database.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without a `.env` file, the app runs fully (homepage, validation, content retrieval) but AI analysis returns a graceful "not configured" error — copy `.env.example` to `.env` and set `GEMINI_API_KEY` to exercise the full flow locally. The in-memory rate limiter and local dev don't need Upstash.

```bash
npm run test   # vitest — 137+ tests
npm run lint
npm run build
```

---

## PRODUCTION DEPLOYMENT

This app is designed for Vercel (serverless Next.js, server-side AI calls, REST-based Redis) and needs no `vercel.json` — the build, routes, and `next.config.ts` headers are picked up automatically.

1. **Create Gemini API credentials** — generate a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. **Configure Gemini billing/quota** — the free tier is **20 requests/day per model** and will not survive real traffic (confirmed by exhausting it during development). Enable billing on the underlying Google Cloud project before pointing real users at this. The app defaults to `gemini-flash-lite-latest` (override via `GEMINI_MODEL`) — chosen for this workload's needs (extraction/summarization/structured JSON, not deep reasoning) and verified against our exact schema/prompt/parsing path before being made the default.
3. **Create an Upstash Redis database** — free tier is fine, see [console.upstash.com](https://console.upstash.com). Copy its REST URL and token (not the regular Redis connection string).
4. **Configure environment variables** in the Vercel project (Settings → Environment Variables, Production scope): `GEMINI_API_KEY`, `RATE_LIMIT_BACKEND`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. See `.env.example` for the full reference and what's optional.
5. **Set `RATE_LIMIT_BACKEND=redis`** — this is not optional for a real deployment. On a serverless platform, the in-memory fallback gives each invocation its own counter, which is effectively no rate limiting at all. If this is set to `redis` without both Upstash variables present, the app refuses to start (fails closed, not open).
6. **Deploy to Vercel** — connect the repo, no custom build settings needed.
7. **Verify the production build** succeeded and the deployment is live (check the Vercel deployment logs for the `[startup]` validation line — it should log nothing if everything's configured, or throw a clear, secret-free error naming exactly which variable is missing).
8. **Run the smoke tests** below against the live URL.
9. **Verify rate limiting**: 12 requests in under 60s across a mix of `/api/analyze`, `/api/explain`, `/api/steps` from the same IP; the 13th should 429.
10. **Verify Gemini**: submit a Reel with a pasted caption and confirm a real structured analysis comes back (not a quota/auth error).
11. **Verify content retrieval**: paste a real public Instagram Reel/Post URL with no caption and confirm it either retrieves Open Graph data or falls back to the "paste a caption" prompt — never a crash.
12. **Verify security behavior**: confirm response headers include `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; confirm a non-Instagram URL is rejected (422) and an oversized body is rejected (413).

Never put real secret values in this file, in `.env.example`, in client components, or in a `NEXT_PUBLIC_*` variable — `GEMINI_API_KEY` and the Upstash credentials are read only by server-side modules under `lib/`.

### Cost control, by design

- **Max 3 Gemini calls per `/api/analyze` (or `/explain`/`/steps`) request** — 1 initial attempt, 1 shared retry (only for timeouts/5xx), 1 schema-repair attempt if the model's JSON didn't validate (which cannot itself retry — the budget is already spent). Typical case is 1 call; quota exhaustion and invalid-API-key failures never retry at all.
- **Worst-case latency** is ~45s (3 attempts × 15s each) — comfortably inside Vercel's current function timeout defaults, with an explicit `maxDuration = 60` set on all three routes regardless.
- **Rate limiting** (12 requests/60s, shared across all three AI endpoints by IP) is the primary abuse control, since there's no authentication.

---

## PRODUCTION SMOKE TEST CHECKLIST

Run against the live deployment before calling it done:

1. [ ] Homepage loads
2. [ ] Invalid URL rejected (client + server)
3. [ ] Valid Instagram URL accepted
4. [ ] Public content can be analyzed (real Gemini response, not an error)
5. [ ] Result renders correctly (summary, CTA, resources, takeaways)
6. [ ] "Explain simply" works
7. [ ] "Turn into steps" works
8. [ ] Copy buttons work
9. [ ] Keyboard navigation reaches every interactive element, with visible focus rings
10. [ ] Mobile layout holds at 375px width
11. [ ] Rate limit triggers at the 13th request/min
12. [ ] Rate limit resets after the window
13. [ ] A simulated Gemini quota error degrades gracefully (content still shown, clear message)
14. [ ] A retrieval failure (private/deleted post) degrades gracefully, prompts for caption
15. [ ] SSRF bypass attempts (userinfo trick, metadata IP, localhost, etc.) stay blocked
16. [ ] Security headers present on every response
17. [ ] No Gemini/Upstash credential appears in any client-side bundle or response
18. [ ] No submitted URL/caption/transcript/analysis is persisted anywhere between requests
19. [ ] Production build succeeds (`npm run build`)
20. [ ] Production logs contain no captions, transcripts, raw IPs, or secrets — only error types, routes, and status

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Upstash Redis](https://upstash.com/docs/redis)
