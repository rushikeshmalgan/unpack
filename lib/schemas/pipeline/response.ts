import type { PointerKind, ReelType } from "@/lib/schemas/pipeline/understanding";

export interface LinkResult {
  title: string;
  url: string;
  source: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  meta?: Record<string, unknown>;
}

export interface PointerResult {
  pointerId: string;
  kind: PointerKind;
  resourceType: string;
  name: string;
  links: LinkResult[];
}

export interface CreatorOwnedItem {
  name: string;
  note: string;
  alternatives: LinkResult[];
}

export interface UnresolvedItem {
  pointerId: string;
  name: string;
  reason: string;
}

export interface EvidencePanel {
  caption: string | null;
  transcriptSnippets: string[];
  onScreenText: string[];
  comments: string[];
}

export interface IngestionStatus {
  status: "full" | "partial" | "manual_only" | "none";
  missing: string[];
}

export interface PipelineResult {
  reel: { url: string; creator: string | null; captionPreview: string | null; reelType: ReelType };
  creatorPromise: string | null;
  results: PointerResult[];
  creatorOwned: CreatorOwnedItem[];
  explore: LinkResult[] | null;
  unresolved: UnresolvedItem[];
  evidencePanel: EvidencePanel;
  warnings: string[];
  ingestion: IngestionStatus;
}
