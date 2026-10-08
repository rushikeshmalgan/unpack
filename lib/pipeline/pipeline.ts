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

async function resolveCandidates(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]> {
  const resolvers = resolversFor(pointer.resourceType);
  const queries = pointer.evidence.length > 0 ? [pointer.name] : [pointer.name];

  const lists = await Promise.all(
    resolvers.flatMap((resolver) =>
      queries.map(async (query) => {
        const cached = await getCachedSearch<Candidate[]>(resolver.id, query);
        if (cached) return cached;
        try {
          const found = await resolver.search({ ...pointer, name: query }, ctx);
          await setCachedSearch(resolver.id, query, found);
          return found;
        } catch (err) {
          console.error(`[pipeline] resolver "${resolver.id}" threw:`, err instanceof Error ? err.name : "unknown");
          return [];
        }
      }),
    ),
  );

  return dedupeCandidates(lists.flat());
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

  const result = await assembleResult(signals, understanding.data, input.mode, { locale: input.locale });
  return { status: "ok", result };
}

async function assembleResult(
  signals: IngestedSignals,
  understanding: UnderstandingResult,
  mode: "exact" | "explore",
  ctx: ResolverContext,
): Promise<PipelineResult> {
  const results: PointerResult[] = [];
  const creatorOwned: CreatorOwnedItem[] = [];
  const unresolved: UnresolvedItem[] = [];

  await mapWithConcurrency(understanding.pointers, POINTER_CONCURRENCY, async (pointer) => {
    if (isLikelyCreatorOwned(pointer)) {
      const alternatives = await findAlternatives(pointer, ctx);
      creatorOwned.push({
        name: pointer.name,
        note: "This looks like the creator's own asset, gated behind a comment/DM — it can't be retrieved directly.",
        alternatives,
      });
      return;
    }

    const candidates = await resolveCandidates(pointer, ctx);
    const links = await verifyAndRank(pointer, candidates);

    if (links.length === 0) {
      unresolved.push({ pointerId: pointer.id, name: pointer.name, reason: "No verified, live match was found." });
      return;
    }

    results.push({ pointerId: pointer.id, kind: pointer.kind, resourceType: pointer.resourceType, name: pointer.name, links });
  });

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
    const candidates = await resolveCandidates(explorePointer, ctx);
    explore = await verifyAndRank(explorePointer, candidates, { maxResults: 5 });
  }

  const warnings: string[] = [];
  if (signals.status === "partial" || signals.status === "manual_only") {
    warnings.push(`Limited signal available (missing: ${signals.missing.join(", ") || "none"}).`);
  }

  return {
    reel: {
      url: signals.sourceUrl,
      creator: signals.creatorUsername,
      captionPreview: signals.caption ? signals.caption.slice(0, 160) : null,
      reelType: understanding.reelType,
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
