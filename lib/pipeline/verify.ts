import { checkLiveness } from "@/lib/pipeline/safeExternalFetch";
import type { Candidate } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";
import type { LinkResult } from "@/lib/schemas/pipeline/response";

// Unicode-aware on purpose: an [a-z0-9] tokenizer erases non-English names
// ("पतंजलि", "Müller") so every candidate for them scores 0 and is dropped.
// Combining marks are kept inside tokens (Devanagari vowel signs are marks),
// but stripped from Latin letters so "Café" still matches "Cafe".
function tokenSet(s: string): Set<string> {
  const normalized = s
    .normalize("NFD")
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase();
  return new Set(normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}

// Titles often carry a subtitle or site suffix ("Deep Work: Rules for Focused
// Success...", "Figma - The Collaborative Interface Design Tool"). The part
// before it is what actually names the thing. A bare hyphen is left alone so
// names like "react-hook-form" stay whole.
function mainTitle(text: string): string {
  return text.split(/\s[-–—|·•]\s|:\s|\s\(/)[0];
}

// Between equally good candidates from one site, the shallower URL is more
// likely to be the thing itself than a page about it: pypi.org/project/requests
// over .../requests/2.17.1, warp.dev over warp.dev/download.
function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function variants(text: string): Set<string>[] {
  return [tokenSet(text), tokenSet(mainTitle(text))];
}

// Dice coefficient: rewards overlap but also penalises extra words, so
// "react" scores 1.0 against "react" and 0.5 against "react native docs".
// (Recall-only overlap scored every title that merely *contained* the name
// as a perfect match.)
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

// Below this a candidate shares too little with the pointer to be worth
// showing, even labelled "low".
const MIN_MATCH_SCORE = 0.3;
const HIGH_THRESHOLD = 0.85;
const MEDIUM_THRESHOLD = 0.5;

// At least this share of the pointer's words must appear somewhere in the
// candidate's title, aliases or snippet. Without it, a search for "Blue Yeti
// microphone" kept "Blue - Wikipedia" as a "medium" match: the title shares
// one word of three, which clears the similarity floor on its own.
const MIN_NAME_COVERAGE = 0.5;

// Encyclopedia pages tie with the real thing on title ("CS50 - Wikipedia" vs
// "CS50: Introduction to Computer Science | Harvard"), and a pointer almost
// always means the thing itself. They still appear — just after an equally
// good primary source.
const SECONDARY_SOURCE = /(^|\.)wikipedia\.org$/;
const SECONDARY_SOURCE_PENALTY = 0.15;

interface Match {
  // 0..1: how well the candidate matches. Drives confidence and the floor.
  score: number;
  // Uncapped: `score` plus the evidence boosts, minus any penalty. Drives
  // ordering. It must not be capped, or the official-domain boost vanishes in
  // a tie: linear.app would tie a LinkedIn page for "Linear" and lose on the
  // search engine's order.
  rank: number;
}

const NO_MATCH: Match = { score: 0, rank: 0 };

function evaluate(pointer: Pointer, candidate: Candidate): Match {
  const nameTokens = tokenSet(pointer.name);
  if (nameTokens.size === 0) return NO_MATCH;

  const nameVariants = variants(pointer.name);
  let best = 0;
  for (const text of [candidate.title, ...(candidate.aliases ?? [])]) {
    for (const c of variants(text)) {
      for (const p of nameVariants) best = Math.max(best, dice(p, c));
    }
  }
  if (best === 0) return NO_MATCH;

  const evidence = tokenSet([candidate.title, ...(candidate.aliases ?? []), candidate.snippet ?? ""].join(" "));
  let covered = 0;
  for (const t of nameTokens) if (evidence.has(t)) covered++;
  if (covered / nameTokens.size < MIN_NAME_COVERAGE) return NO_MATCH;

  // Official-source heuristic: the candidate's own domain contains a name
  // token (e.g. pointer "Excalidraw" -> source "excalidraw.com").
  let boosted = best;
  const sourceTokens = tokenSet(candidate.source);
  if ([...sourceTokens].some((t) => nameTokens.has(t) && t.length > 3)) boosted += 0.3;

  if (pointer.attributes.creator) {
    const creatorTokens = tokenSet(pointer.attributes.creator);
    const textTokens = tokenSet(`${candidate.snippet ?? ""} ${candidate.title}`);
    if ([...textTokens].some((t) => creatorTokens.has(t))) boosted += 0.15;
  }

  const penalty = SECONDARY_SOURCE.test(candidate.source) ? SECONDARY_SOURCE_PENALTY : 0;
  return { score: Math.min(boosted, 1), rank: boosted - penalty };
}

function confidenceFromScore(score: number): LinkResult["confidence"] {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

function buildReason(pointer: Pointer, confidence: LinkResult["confidence"]): string {
  if (confidence === "high") return `Matches "${pointer.name}" closely.`;
  if (confidence === "medium") return `Likely match for "${pointer.name}" — check it's the one you meant.`;
  return `Possible match for "${pointer.name}" — lower confidence.`;
}

// Keeps the first occurrence of each distinct (host + path) — candidates
// with an unparseable URL are dropped entirely rather than risking a bad
// link downstream.
export function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const c of candidates) {
    let key: string;
    try {
      const u = new URL(c.url);
      key = `${u.hostname}${u.pathname}`.replace(/\/$/, "").toLowerCase();
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

// HARD RULE defense in depth: even though verifyAndRank only ever builds
// LinkResults from real Candidate objects, this standalone post-check
// guarantees it — any future code path (e.g. an LLM-judge step) that
// produces a URL not present in what Stage C actually retrieved gets
// stripped here before it can reach the user.
export function stripUnretrievedUrls(links: LinkResult[], retrievedCandidates: Candidate[]): LinkResult[] {
  const retrievedUrls = new Set(retrievedCandidates.map((c) => c.url));
  return links.filter((link) => retrievedUrls.has(link.url));
}

export interface VerifyOptions {
  checkLivenessEnabled?: boolean;
  maxResults?: number;
  // For "related reading on a topic" rather than "find this specific thing":
  // there is no name to match, so candidates are not scored or filtered and
  // keep the search engine's own relevance order. They are verified live and
  // labelled as related reading, not as a match.
  topical?: boolean;
}

const toHundredths = (n: number) => Math.round(n * 100);

export async function verifyAndRank(
  pointer: Pointer,
  rawCandidates: Candidate[],
  options: VerifyOptions = {},
): Promise<LinkResult[]> {
  const { checkLivenessEnabled = true, maxResults = 3, topical = false } = options;

  const deduped = dedupeCandidates(rawCandidates);

  // Candidates arrive grouped by resolver in registry order, so a source's
  // first appearance doubles as its resolver priority.
  const sourceOrder = new Map<string, number>();
  for (const c of deduped) if (!sourceOrder.has(c.source)) sourceOrder.set(c.source, sourceOrder.size);

  // Order: how well the name matches (with evidence boosts), then resolver
  // priority, then popularity. Popularity (raw GitHub stars, App Store rating
  // counts, ...) is only comparable inside one source, so it can only break
  // ties there — it must never let a popular repo outrank the package registry
  // the pointer named.
  const evaluated = deduped.map((candidate, index) => ({
    candidate,
    index,
    depth: pathDepth(candidate.url),
    ...(topical ? { score: 1, rank: 0 } : evaluate(pointer, candidate)),
  }));
  const scored = evaluated
    .filter((s) => s.score >= MIN_MATCH_SCORE)
    .sort(
      (a, b) =>
        toHundredths(b.rank) - toHundredths(a.rank) ||
        sourceOrder.get(a.candidate.source)! - sourceOrder.get(b.candidate.source)! ||
        (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0) ||
        a.depth - b.depth ||
        a.index - b.index,
    )
    .slice(0, maxResults * 2);

  const withLiveness = checkLivenessEnabled
    ? await Promise.all(scored.map(async (s) => ({ ...s, alive: (await checkLiveness(s.candidate.url)).ok })))
    : scored.map((s) => ({ ...s, alive: true }));

  const links = withLiveness
    .filter((s) => s.alive)
    .slice(0, maxResults)
    .map(({ candidate, score }, position) => {
      // Name equality alone can't prove which of several same-named things is
      // "the" one, so only the best-ranked result may claim "high".
      let confidence = confidenceFromScore(score);
      if (position > 0 && confidence === "high") confidence = "medium";
      return {
        title: candidate.title,
        url: candidate.url,
        source: candidate.source,
        reason: topical ? "Related reading on this topic." : buildReason(pointer, confidence),
        // Topical results aren't matches, so they carry the lowest confidence
        // (the UI doesn't show a badge for them).
        confidence: topical ? ("low" as const) : confidence,
        meta: candidate.meta,
      };
    });

  return stripUnretrievedUrls(links, deduped);
}
