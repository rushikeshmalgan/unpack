import type { Resolver } from "@/lib/pipeline/resolvers/types";
import { githubResolver } from "@/lib/pipeline/resolvers/githubResolver";
import { packageResolver } from "@/lib/pipeline/resolvers/packageResolver";
import { bookResolver } from "@/lib/pipeline/resolvers/bookResolver";
import { academicResolver } from "@/lib/pipeline/resolvers/academicResolver";
import { placesResolver } from "@/lib/pipeline/resolvers/placesResolver";
import { appStoreResolver } from "@/lib/pipeline/resolvers/appStoreResolver";
import { wikidataResolver } from "@/lib/pipeline/resolvers/wikidataResolver";
import { youtubeResolver } from "@/lib/pipeline/resolvers/youtubeResolver";
import { webSearchResolver } from "@/lib/pipeline/resolvers/webSearchResolver";

// Adding a resolver = write one file implementing `Resolver`, then add it
// here. Order is resolver priority: when two resolvers return equally good
// name matches, the earlier one's result ranks first (e.g. a `library_package`
// pointer lists the registry page before a same-named GitHub repo).
// webSearchResolver must stay last (it matches every resourceType as the
// universal fallback).
export const RESOLVERS: Resolver[] = [
  packageResolver,
  githubResolver,
  bookResolver,
  academicResolver,
  placesResolver,
  appStoreResolver,
  wikidataResolver,
  youtubeResolver,
  webSearchResolver,
];

export function resolversFor(resourceType: string): Resolver[] {
  return RESOLVERS.filter((r) => r.handles(resourceType));
}
