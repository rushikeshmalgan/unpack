import { checkLiveness } from "@/lib/pipeline/safeExternalFetch";
import type { Candidate } from "@/lib/pipeline/resolvers/types";
import type { Pointer } from "@/lib/schemas/pipeline/understanding";
import type { LinkResult } from "@/lib/schemas/pipeline/response";

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function scoreCandidate(pointer: Pointer, candidate: Candidate): number {
  const nameTokens = new Set(tokenize(pointer.name));
  if (nameTokens.size === 0) return 0;

  const titleTokens = tokenize(candidate.title);
  let overlap = 0;
  for (const t of titleTokens) if (nameTokens.has(t)) overlap++;
  let score = overlap / nameTokens.size;

  // Official-source heuristic: the candidate's own domain contains a name
  // token (e.g. pointer "Excalidraw" -> source "excalidraw.com").
  const sourceTokens = tokenize(candidate.source);
  if (sourceTokens.some((t) => nameTokens.has(t) && t.length > 3)) score += 0.3;

  if (pointer.attributes.creator) {
    const creatorTokens = new Set(tokenize(pointer.attributes.creator));
    const snippetTokens = tokenize(`${candidate.snippet ?? ""} ${candidate.title}`);
    if (snippetTokens.some((t) => creatorTokens.has(t))) score += 0.15;
  }

  return Math.min(score, 1);
}

function confidenceFromScore(score: number): LinkResult["confidence"] {
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

function buildReason(pointer: Pointer, score: number): string {
  if (score >= 0.6) return `Matches "${pointer.name}" closely on name and source.`;
  if (score >= 0.3) return `Likely match for "${pointer.name}" based on title and source.`;
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
}

export async function verifyAndRank(
  pointer: Pointer,
  rawCandidates: Candidate[],
  options: VerifyOptions = {},
): Promise<LinkResult[]> {
  const { checkLivenessEnabled = true, maxResults = 3 } = options;

  const deduped = dedupeCandidates(rawCandidates);
  const scored = deduped
    .map((candidate) => ({ candidate, score: scoreCandidate(pointer, candidate) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults * 2);

  const withLiveness = checkLivenessEnabled
    ? await Promise.all(scored.map(async (s) => ({ ...s, alive: (await checkLiveness(s.candidate.url)).ok })))
    : scored.map((s) => ({ ...s, alive: true }));

  const links = withLiveness
    .filter((s) => s.alive)
    .slice(0, maxResults)
    .map(({ candidate, score }) => ({
      title: candidate.title,
      url: candidate.url,
      source: candidate.source,
      reason: buildReason(pointer, score),
      confidence: confidenceFromScore(score),
      meta: candidate.meta,
    }));

  return stripUnretrievedUrls(links, deduped);
}
