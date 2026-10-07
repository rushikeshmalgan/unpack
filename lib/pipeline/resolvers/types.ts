import type { Pointer } from "@/lib/schemas/pipeline/understanding";

export interface Candidate {
  url: string;
  title: string;
  source: string;
  publishedDate?: string | null;
  snippet?: string | null;
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
