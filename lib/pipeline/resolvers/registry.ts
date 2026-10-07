import type { Resolver } from "@/lib/pipeline/resolvers/types";
import { githubResolver } from "@/lib/pipeline/resolvers/githubResolver";
import { packageResolver } from "@/lib/pipeline/resolvers/packageResolver";
import { bookResolver } from "@/lib/pipeline/resolvers/bookResolver";
import { academicResolver } from "@/lib/pipeline/resolvers/academicResolver";
import { placesResolver } from "@/lib/pipeline/resolvers/placesResolver";
import { appStoreResolver } from "@/lib/pipeline/resolvers/appStoreResolver";
import { youtubeResolver } from "@/lib/pipeline/resolvers/youtubeResolver";
import { webSearchResolver } from "@/lib/pipeline/resolvers/webSearchResolver";

// Adding a resolver = write one file implementing `Resolver`, then add it
// here. Order matters only in that webSearchResolver must stay last (it
// matches every resourceType as the universal fallback).
export const RESOLVERS: Resolver[] = [
  githubResolver,
  packageResolver,
  bookResolver,
  academicResolver,
  placesResolver,
  appStoreResolver,
  youtubeResolver,
  webSearchResolver,
];

export function resolversFor(resourceType: string): Resolver[] {
  return RESOLVERS.filter((r) => r.handles(resourceType));
}
