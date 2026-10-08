import type { Pointer } from "@/lib/schemas/pipeline/understanding";

export interface Candidate {
  url: string;
  title: string;
  source: string;
  publishedDate?: string | null;
  snippet?: string | null;
  // Other names this candidate is known by (e.g. a GitHub repo's short name
  // alongside its "owner/repo" title). Matching takes the best score across
  // the title and every alias.
  aliases?: string[];
  // A raw, source-specific popularity count (GitHub stars, App Store rating
  // count). Only ever compared between candidates from the SAME source, to
  // break ties between equally good name matches — so no cross-source
  // normalisation is needed or attempted.
  popularity?: number;
  // Resolver-specific extras: stars, rating, duration, price, address, etc.
  meta?: Record<string, unknown>;
}

export interface ResolverContext {
  locale?: string;
}

export interface Resolver {
  id: string;
  handles(resourceType: string): boolean;
  search(pointer: Pointer, ctx: ResolverContext): Promise<Candidate[]>;
}

export interface ResolverWarning {
  resolverId: string;
  reason: string;
}
