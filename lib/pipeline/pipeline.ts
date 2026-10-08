import { validateInstagramUrl, describeUrlError } from "@/lib/validation";
import { ingestReel, type ManualFallbackInput, type IngestedSignals } from "@/lib/pipeline/ingest/ingestReel";
import { understandReel } from "@/lib/pipeline/understand";
import { resolversFor } from "@/lib/pipeline/resolvers/registry";
import { webSearchResolver } from "@/lib/pipeline/resolvers/webSearchResolver";
import { verifyAndRank, dedupeCandidates } from "@/lib/pipeline/verify";
import { checkLiveness } from "@/lib/pipeline/safeExternalFetch";
import { mapWithConcurrency } from "@/lib/pipeline/concurrency";
import { getCachedIngestion, setCachedIngestion, getCachedSearch, setCachedSearch } from "@/lib/pipeline/cache";
import type { Candidate, ResolverContext } from "@/lib/pipeline/resolvers/types";
import type { Pointer, UnderstandingResult } from "@/lib/schemas/pipeline/understanding";
import type {
  PipelineResult,
  PointerResult,
  CreatorOwnedItem,
  UnresolvedItem,
  LinkResult,
} from "@/lib/schemas/pipeline/response";
import type { AIProviderError } from "@/lib/ai/providerError";

const POINTER_CONCURRENCY = 4;
const MIN_SUFFICIENT_SIGNAL_LENGTH = 20;

// Everything from ingestion through link-finding has to fit inside the
// route's `maxDuration` (60s) or the platform kills the request and the user
// gets an opaque error instead of anything. The AI call alone can take 45s on
// a bad day, so link-finding gets whatever is left of this budget and returns
// partial results rather than running past it.
export const PIPELINE_BUDGET_MS = 50_000;

const TIMED_OUT_REASON = "Ran out of time while searching for this one — try again.";

const CREATOR_OWNED_RESOURCE_TYPES = new Set(["template", "prompt", "design_asset"]);
const CREATOR_OWNED_LANGUAGE = /\b(my|i'll send|i will send|i made|dm you|i created|my own)\b/i;

function hasManualInput(manual: ManualFallbackInput): boolean {
  return Object.values(manual).some((v) => typeof v === "string" && v.trim().length > 0);
}

function isLikelyCreatorOwned(pointer: Pointer): boolean {
  if (pointer.kind !== "gated") return false;
  if (CREATOR_OWNED_RESOURCE_TYPES.has(pointer.resourceType)) return true;
  return CREATOR_OWNED_LANGUAGE.test(pointer.name);
}

// Everything a resolver's query can depend on, not just the name: Nominatim
// searches name + location (+ locale) and the web-search hint depends on the
// resourceType, so keying on name alone would serve "Cafe Zoe" in Goa the
// cached answer for "Cafe Zoe" in Paris.
function searchCacheKey(pointer: Pointer, ctx: ResolverContext): string {
  return [pointer.name, pointer.resourceType, pointer.attributes.location ?? "", ctx.locale ?? ""].join("|");
}

async function resolveCandidates(
  pointer: Pointer,
  ctx: ResolverContext,
): Promise<{ candidates: Candidate[]; issues: string[] }> {
  const issues = new Set<string>();
  const cacheKey = searchCacheKey(pointer, ctx);

  const lists = await Promise.all(
    resolversFor(pointer.resourceType).map(async (resolver) => {
      const cached = await getCachedSearch<Candidate[]>(resolver.id, cacheKey);
      if (cached) return cached;

      let couldNotSearch = false;
      const callCtx: ResolverContext = {
        ...ctx,
        reportIssue: (message) => {
          couldNotSearch = true;
          issues.add(message);
        },
      };

      try {
        const found = await resolver.search(pointer, callCtx);
        // An empty list from a call that failed (rate limit, outage, missing
        // key) is not "no results" — caching it would hide the pointer for the
        // whole TTL after the problem is gone.
        if (!couldNotSearch) await setCachedSearch(resolver.id, cacheKey, found);
        return found;
      } catch (err) {
        console.error(`[pipeline] resolver "${resolver.id}" threw:`, err instanceof Error ? err.name : "unknown");
        issues.add(`${resolver.id} failed unexpectedly`);
        return [];
      }
    }),
  );

  return { candidates: dedupeCandidates(lists.flat()), issues: [...issues] };
}

async function findAlternatives(pointer: Pointer, ctx: ResolverContext): Promise<LinkResult[]> {
  const topicQuery = pointer.attributes.topic
    ? `best ${pointer.attributes.topic} resources`
    : `${pointer.resourceType.replace(/_/g, " ")} like ${pointer.name}`;

  const resolvers = resolversFor(pointer.resourceType);
  const pool = resolvers.length > 0 ? resolvers : [webSearchResolver];
  const lists = await Promise.all(pool.map((r) => r.search({ ...pointer, name: topicQuery }, ctx).catch(() => [])));
  const candidates = dedupeCandidates(lists.flat()).slice(0, 5);

  const checked = await Promise.all(
    candidates.map(async (c) => ({ candidate: c, alive: (await checkLiveness(c.url)).ok })),
  );

  return checked
    .filter((c) => c.alive)
    .slice(0, 3)
    .map(({ candidate }) => ({
      title: candidate.title,
      url: candidate.url,
      source: candidate.source,
      reason: `Public alternative related to "${pointer.name}" — not the creator's original.`,
      confidence: "medium" as const,
      meta: candidate.meta,
    }));
}

export interface PipelineInput {
  url: string;
  manual: ManualFallbackInput;
  mode: "exact" | "explore";
  locale?: string;
}

export type PipelineOutcome =
  | { status: "invalid_url"; message: string }
  | { status: "insufficient"; signals: IngestedSignals }
  | { status: "ai_error"; error: AIProviderError; signals: IngestedSignals }
  | { status: "ok"; result: PipelineResult };

export async function runPipeline(input: PipelineInput): Promise<PipelineOutcome> {
  const deadlineAt = Date.now() + PIPELINE_BUDGET_MS;
  const validated = validateInstagramUrl(input.url);
  if (!validated.ok) {
    return { status: "invalid_url", message: describeUrlError(validated.reason) };
  }

  // The ingestion cache is shared across all users and keyed only by reel
  // shortcode, so it may only ever hold what was retrieved automatically
  // (extractor / public metadata). Anything the user pasted is private to
  // their request: reading the cache would let a stale entry override their
  // input, and writing it would serve their text to the next person who
  // submits the same reel (leakage, and a cache-poisoning vector).
  const usesManualInput = hasManualInput(input.manual);
  const cached = usesManualInput ? null : await getCachedIngestion<IngestedSignals>(validated.shortcode);
  let signals: IngestedSignals;
  if (cached) {
    signals = cached;
  } else {
    const ingestOutcome = await ingestReel(input.url, input.manual);
    if (!ingestOutcome.ok) {
      return { status: "invalid_url", message: ingestOutcome.message };
    }
    signals = ingestOutcome.signals;
    // "none" is never cached: a transient extractor/metadata failure would
    // otherwise be remembered as "this reel has no content" for the full TTL.
    if (!usesManualInput && signals.status !== "none") {
      await setCachedIngestion(validated.shortcode, signals);
    }
  }

  const signalLength = (signals.caption?.length ?? 0) + (signals.transcript?.length ?? 0) + (signals.onScreenText?.length ?? 0);
  if (signalLength < MIN_SUFFICIENT_SIGNAL_LENGTH) {
    return { status: "insufficient", signals };
  }

  const understanding = await understandReel(signals);
  if (!understanding.ok) {
    return { status: "ai_error", error: understanding.error, signals };
  }

  const result = await assembleResult(signals, understanding.data, input.mode, { locale: input.locale }, deadlineAt);
  return { status: "ok", result };
}

type PointerOutcome =
  | { kind: "resolved"; result: PointerResult }
  | { kind: "creator_owned"; item: CreatorOwnedItem }
  | { kind: "unresolved"; item: UnresolvedItem; timedOut?: boolean };

function unresolvedOutcome(pointer: Pointer, reason: string, timedOut = false): PointerOutcome {
  return { kind: "unresolved", item: { pointerId: pointer.id, name: pointer.name, reason }, timedOut };
}

// Runs `work` unless the budget is already spent, and stops waiting for it
// once the budget runs out. It cannot cancel `work` (the in-flight requests
// finish on their own and their results are discarded), but the caller gets
// its answer on time.
async function withinBudget<T>(deadlineAt: number, work: () => Promise<T>, onExpired: () => T): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return onExpired();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onExpired()), remaining);
  });
  try {
    return await Promise.race([work(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePointer(pointer: Pointer, ctx: ResolverContext): Promise<PointerOutcome> {
  if (isLikelyCreatorOwned(pointer)) {
    const alternatives = await findAlternatives(pointer, ctx);
    return {
      kind: "creator_owned",
      item: {
        name: pointer.name,
        note: "This looks like the creator's own asset, gated behind a comment/DM — it can't be retrieved directly.",
        alternatives,
      },
    };
  }

  const { candidates, issues } = await resolveCandidates(pointer, ctx);
  const links = await verifyAndRank(pointer, candidates);

  if (links.length === 0) {
    // "Couldn't search" and "searched, nothing matched" are different
    // outcomes; say which, so a rate limit doesn't read as "doesn't exist".
    const reason =
      issues.length > 0
        ? `Not found, and some sources couldn't be searched (${issues.join("; ")}).`
        : "No verified, live match was found.";
    return unresolvedOutcome(pointer, reason);
  }

  return {
    kind: "resolved",
    result: { pointerId: pointer.id, kind: pointer.kind, resourceType: pointer.resourceType, name: pointer.name, links },
  };
}

async function assembleResult(
  signals: IngestedSignals,
  understanding: UnderstandingResult,
  mode: "exact" | "explore",
  ctx: ResolverContext,
  deadlineAt: number,
): Promise<PipelineResult> {
  const results: PointerResult[] = [];
  const creatorOwned: CreatorOwnedItem[] = [];
  const unresolved: UnresolvedItem[] = [];

  // Outcomes come back in the reel's own order (mapWithConcurrency preserves
  // it), so "5 tools" is listed as the creator listed them rather than in
  // whatever order the lookups happened to finish. One pointer failing, or
  // running out of time, never takes the others down with it.
  const outcomes = await mapWithConcurrency(understanding.pointers, POINTER_CONCURRENCY, async (pointer) => {
    try {
      return await withinBudget(
        deadlineAt,
        () => resolvePointer(pointer, ctx),
        () => unresolvedOutcome(pointer, TIMED_OUT_REASON, true),
      );
    } catch (err) {
      console.error("[pipeline] pointer failed:", err instanceof Error ? err.name : "unknown");
      return unresolvedOutcome(pointer, "Something went wrong while searching for this one.");
    }
  });

  let timedOut = false;
  for (const outcome of outcomes) {
    if (outcome.kind === "resolved") results.push(outcome.result);
    else if (outcome.kind === "creator_owned") creatorOwned.push(outcome.item);
    else {
      unresolved.push(outcome.item);
      timedOut ||= outcome.timedOut === true;
    }
  }

  const warnings: string[] = [];
  if (signals.status === "partial" || signals.status === "manual_only") {
    warnings.push(`Limited signal available (missing: ${signals.missing.join(", ") || "none"}).`);
  }
  if (timedOut) {
    warnings.push("Some links took too long to look up and were skipped — try again for those.");
  }

  // [] means "looked for related reading and found none"; null means "didn't
  // look" (exact mode with pointers to resolve).
  let explore: LinkResult[] | null = null;
  const shouldExplore = mode === "explore" || understanding.pointers.length === 0;
  if (shouldExplore) {
    const topic = understanding.topicIfNoPointers ?? understanding.pointers[0]?.attributes.topic ?? understanding.reelType;
    const explorePointer: Pointer = {
      id: "explore",
      kind: "implicit",
      resourceType: "other",
      name: `best resources to learn about ${topic}`,
      attributes: { creator: null, year: null, topic, language: null, location: null, visibleUrl: null, price: null },
      evidence: [],
      confidence: 0.5,
    };
    const found = await withinBudget(
      deadlineAt,
      async () => {
        const { candidates, issues } = await resolveCandidates(explorePointer, ctx);
        return { links: await verifyAndRank(explorePointer, candidates, { maxResults: 5 }), issues };
      },
      () => ({ links: [] as LinkResult[], issues: ["it ran out of time"] }),
    );
    explore = found.links;
    if (explore.length === 0) {
      const why = found.issues.length > 0 ? ` (${found.issues.join("; ")})` : "";
      warnings.push(`Couldn't find related reading for this topic${why}.`);
    }
  }

  return {
    reel: {
      url: signals.sourceUrl,
      creator: signals.creatorUsername,
      captionPreview: signals.caption ? signals.caption.slice(0, 160) : null,
      reelType: understanding.reelType,
      topic: understanding.topicIfNoPointers,
    },
    creatorPromise: understanding.creatorPromise,
    results,
    creatorOwned,
    explore,
    unresolved,
    evidencePanel: {
      caption: signals.caption,
      transcriptSnippets: signals.transcript ? [signals.transcript.slice(0, 500)] : [],
      onScreenText: signals.onScreenText ? [signals.onScreenText.slice(0, 500)] : [],
      comments: signals.comments ? [signals.comments.slice(0, 500)] : [],
    },
    warnings,
    ingestion: { status: signals.status, missing: signals.missing },
  };
}
