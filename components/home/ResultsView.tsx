"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatAllLinks, formatLinks } from "@/lib/clipboardFormat";
import type { PipelineResult, LinkResult, PointerResult, CreatorOwnedItem, UnresolvedItem } from "@/lib/schemas/pipeline/response";

const RESOURCE_ICONS: Record<string, string> = {
  video: "🎥", channel: "📺", playlist: "📋", podcast_episode: "🎧", podcast: "🎧",
  article: "📰", blog_post: "📰", newsletter: "📧", research_paper: "📄", book: "📚",
  course: "🎓", tutorial: "🎓", documentation: "📘", website: "🌐", web_tool: "🌐",
  app_mobile: "📱", app_desktop: "💻", browser_extension: "🧩", github_repo: "💻",
  library_package: "📦", api: "🔌", dataset: "📊", ai_model: "🤖", prompt: "✏️",
  template: "📝", design_asset: "🎨", font: "🔤", product: "🛍️", deal_or_coupon: "🏷️",
  software_alternative: "🔁", place: "📍", restaurant_or_cafe: "📍", event: "📅",
  recipe: "🍳", song: "🎵", album: "🎵", movie_or_show: "🎬", game: "🎮",
  job_or_internship: "💼", scholarship_or_program: "💼", community: "👥",
  social_account: "👤", person_profile: "👤", quote_source: "💬", news_event: "📰",
};

function iconFor(resourceType: string): string {
  return RESOURCE_ICONS[resourceType] ?? "🔗";
}

const CONFIDENCE_STYLE: Record<LinkResult["confidence"], string> = {
  high: "border-accent/40 text-accent",
  medium: "border-notice-border text-notice",
  low: "border-border text-muted-foreground",
};

function ConfidenceBadge({ confidence }: { confidence: LinkResult["confidence"] }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${CONFIDENCE_STYLE[confidence]}`}>
      {confidence}
    </span>
  );
}

function LinkCard({ link }: { link: LinkResult }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{link.title}</p>
          <p className="truncate text-xs text-muted-foreground">{link.source}</p>
        </div>
        <ConfidenceBadge confidence={link.confidence} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{link.reason}</p>
      <div className="mt-2 flex items-center gap-2">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open
        </a>
        <CopyButton label="Copy link" getText={() => link.url} />
      </div>
    </div>
  );
}

function PointerCard({ pointer }: { pointer: PointerResult }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span aria-hidden>{iconFor(pointer.resourceType)}</span>
          {pointer.name}
        </h3>
        <CopyButton label="Copy" getText={() => formatLinks(pointer.links)} />
      </div>
      <div className="mt-3 space-y-2">
        {pointer.links.map((link) => (
          <LinkCard key={link.url} link={link} />
        ))}
      </div>
    </div>
  );
}

function CreatorOwnedCard({ item }: { item: CreatorOwnedItem }) {
  return (
    <div className="rounded-xl border border-notice-border bg-notice-bg p-4">
      <h3 className="text-sm font-semibold text-foreground">{item.name}</h3>
      <p className="mt-1 text-xs text-notice">{item.note}</p>
      {item.alternatives.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Public alternatives
          </p>
          {item.alternatives.map((link) => (
            <LinkCard key={link.url} link={link} />
          ))}
        </div>
      )}
    </div>
  );
}

function UnresolvedRow({ item }: { item: UnresolvedItem }) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(item.name)}`;
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block text-foreground">{item.name}</span>
        <span className="block text-xs text-muted-foreground">{item.reason}</span>
      </span>
      <a
        href={searchUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="shrink-0 text-xs font-medium text-accent hover:underline"
      >
        Search manually
      </a>
    </li>
  );
}

export function ResultsView({
  result,
  mode,
  onToggleExplore,
  onReanalyze,
  onReset,
  reanalyzing,
  reanalyzeError,
}: {
  result: PipelineResult;
  mode: "exact" | "explore";
  onToggleExplore: () => void;
  onReanalyze: () => void;
  onReset: () => void;
  reanalyzing: boolean;
  reanalyzeError: string | null;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const hasEvidence =
    result.evidencePanel.caption ||
    result.evidencePanel.transcriptSnippets.length > 0 ||
    result.evidencePanel.onScreenText.length > 0 ||
    result.evidencePanel.comments.length > 0;
  const hasExplore = (result.explore?.length ?? 0) > 0;
  const nothingToShow =
    result.results.length === 0 && result.creatorOwned.length === 0 && result.unresolved.length === 0 && !hasExplore;

  return (
    <div className="space-y-5 rounded-xl border border-border bg-surface p-5 sm:p-8">
      <div role="status" className="sr-only">
        Links ready.
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent">{result.reel.reelType.replace(/_/g, " ")}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{result.reel.url}</p>
        </div>
        <button
          type="button"
          onClick={onToggleExplore}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {mode === "exact" ? "Explore topic instead" : "Back to exact matches"}
        </button>
      </div>

      {result.creatorPromise && (
        <p className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          Creator promise: {result.creatorPromise}
        </p>
      )}

      {result.warnings.map((w, i) => (
        <p key={i} className="rounded-lg border border-notice-border bg-notice-bg px-3 py-2 text-sm text-notice">
          {w}
        </p>
      ))}

      {result.results.length > 0 && (
        <div className="space-y-3">
          {result.results.map((r) => (
            <PointerCard key={r.pointerId} pointer={r} />
          ))}
        </div>
      )}

      {result.creatorOwned.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Creator-owned (can&apos;t be found)</h3>
          {result.creatorOwned.map((item) => (
            <CreatorOwnedCard key={item.name} item={item} />
          ))}
        </div>
      )}

      {result.unresolved.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Couldn&apos;t find</h3>
          <ul className="space-y-1.5">
            {result.unresolved.map((item) => (
              <UnresolvedRow key={item.pointerId} item={item} />
            ))}
          </ul>
        </div>
      )}

      {hasExplore && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Related to this reel&apos;s topic</h3>
          <div className="space-y-2">
            {result.explore!.map((link) => (
              <LinkCard key={link.url} link={link} />
            ))}
          </div>
        </div>
      )}

      {nothingToShow && (
        <p className="text-sm text-muted-foreground">
          {result.reel.topic ? (
            <>
              This reel doesn&apos;t point to anything specific — it&apos;s about{" "}
              <strong className="text-foreground">{result.reel.topic}</strong>.
            </>
          ) : (
            "Nothing specific to point to in this content."
          )}
          {/* An empty `explore` means related reading was already tried, so
              suggesting the toggle would send the user in a circle. */}
          {result.explore === null && <> Try &quot;Explore topic instead&quot; above for related reading.</>}
        </p>
      )}

      {hasEvidence && (
        <div>
          <button
            type="button"
            onClick={() => setEvidenceOpen((v) => !v)}
            aria-expanded={evidenceOpen}
            className="rounded text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {evidenceOpen ? "Hide" : "Show"} what the AI saw in this reel
          </button>
          {evidenceOpen && (
            <div className="mt-2 space-y-2 rounded-lg bg-background p-3 text-xs text-muted-foreground">
              {result.evidencePanel.caption && <p><strong className="text-foreground">Caption:</strong> {result.evidencePanel.caption}</p>}
              {result.evidencePanel.transcriptSnippets.map((s, i) => (
                <p key={i}><strong className="text-foreground">Transcript:</strong> {s}</p>
              ))}
              {result.evidencePanel.onScreenText.map((s, i) => (
                <p key={i}><strong className="text-foreground">On-screen:</strong> {s}</p>
              ))}
              {result.evidencePanel.comments.map((s, i) => (
                <p key={i}><strong className="text-foreground">Comments:</strong> {s}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <CopyButton label="Copy all links" getText={() => formatAllLinks(result)} />
      </div>

      {reanalyzeError && (
        <p role="alert" className="text-sm text-danger">
          {reanalyzeError}
        </p>
      )}

      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onReanalyze} disabled={reanalyzing}>
          {reanalyzing ? "Analyzing…" : "Analyze again"}
        </Button>
        <Button type="button" variant="ghost" onClick={onReset} disabled={reanalyzing}>
          Find links in another reel
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">Nothing from this analysis is saved.</p>
    </div>
  );
}
