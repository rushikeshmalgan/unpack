"use client";

import { useState } from "react";
import type { NormalizedContent } from "@/lib/content/types";
import type { AnalysisResult as AnalysisData } from "@/lib/schemas/analysisResult";
import type { ExplainResponse, RetrievalStatus, StepsResponse } from "@/lib/apiTypes";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { isSafeImageUrl } from "@/lib/content/htmlMeta";
import {
  formatActionItems,
  formatFullAnalysis,
  formatKeyTakeaways,
  formatResources,
  formatWhatShouldIDo,
} from "@/lib/clipboardFormat";

type AsyncPanel<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: T }
  | { status: "error"; message: string };

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span aria-hidden>{icon}</span>
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-muted-foreground">—</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function AnalysisResult({
  content,
  analysis,
  retrieval,
  aiError,
  onReanalyze,
  onReset,
  reanalyzing,
  reanalyzeError,
}: {
  content: NormalizedContent;
  analysis: AnalysisData | null;
  retrieval: RetrievalStatus;
  aiError: { code: string; message: string } | null;
  onReanalyze: () => void;
  onReset: () => void;
  reanalyzing: boolean;
  reanalyzeError: string | null;
}) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [explainPanel, setExplainPanel] = useState<AsyncPanel<{ overview: string; terms: { term: string; simple: string }[] }>>({
    status: "idle",
  });
  const [stepsPanel, setStepsPanel] = useState<AsyncPanel<string[]>>({ status: "idle" });

  async function handleExplainSimply() {
    if (!analysis) return;
    setExplainPanel({ status: "loading" });
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: analysis.summary.detailed,
          technologies: analysis.technologies,
        }),
      });
      const data: ExplainResponse = await res.json();
      if (!res.ok || !data.success) {
        setExplainPanel({
          status: "error",
          message: !data.success ? data.error.message : "Something went wrong. Please try again.",
        });
        return;
      }
      setExplainPanel({ status: "done", data: data.explanation });
    } catch {
      setExplainPanel({ status: "error", message: "We couldn't reach the server. Please try again." });
    }
  }

  async function handleTurnIntoSteps() {
    if (!analysis) return;
    setStepsPanel({ status: "loading" });
    try {
      const res = await fetch("/api/steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: analysis.summary.detailed,
          whatUserShouldDo: analysis.whatUserShouldDo,
          actionItems: analysis.actionItems,
          technologies: analysis.technologies,
        }),
      });
      const data: StepsResponse = await res.json();
      if (!res.ok || !data.success) {
        setStepsPanel({
          status: "error",
          message: !data.success ? data.error.message : "Something went wrong. Please try again.",
        });
        return;
      }
      setStepsPanel({ status: "done", data: data.steps });
    } catch {
      setStepsPanel({ status: "error", message: "We couldn't reach the server. Please try again." });
    }
  }

  const resourceGroups = analysis
    ? ([
        ["Websites", analysis.resources.websites],
        ["Tools", analysis.resources.tools],
        ["Courses", analysis.resources.courses],
        ["Books", analysis.resources.books],
        ["Repositories", analysis.resources.repositories],
        ["People", analysis.resources.people],
        ["Companies", analysis.resources.companies],
      ] as const).filter(([, items]) => items.length > 0)
    : [];

  const showWhatShouldIDo = !!analysis && analysis.whatUserShouldDo.length > 0;
  const showWhatYouGet = !!analysis && (analysis.cta.detected || analysis.whatUserGets.identified);

  return (
    <div className="space-y-5 rounded-xl border border-border bg-surface p-5 sm:p-8">
      <div role="status" className="sr-only">
        {content.contentType === "post" ? "Post" : "Reel"} analysis ready.
      </div>
      <div className="flex items-start gap-4">
        {isSafeImageUrl(content.metadata.imageUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.metadata.imageUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent">
            {content.contentType === "post" ? "Post" : "Reel"} analyzed
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{content.sourceUrl}</p>
        </div>
      </div>

      {aiError && (
        <p className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {aiError.message} The content we retrieved is still shown below.
        </p>
      )}

      {analysis && (
        <>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span aria-hidden>📝</span>
              What is this?
            </h3>
            <p className="mt-2 text-sm text-foreground">{analysis.summary.tldr}</p>
            <button
              type="button"
              onClick={() => setSummaryExpanded((v) => !v)}
              aria-expanded={summaryExpanded}
              className="mt-2 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {summaryExpanded ? "Show less" : "Show more detail"}
            </button>
            {summaryExpanded && (
              <div className="mt-3 space-y-3 rounded-lg bg-background p-3 text-sm text-muted-foreground">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Quick summary
                  </p>
                  <p className="mt-1">{analysis.summary.quick}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Detailed breakdown
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{analysis.summary.detailed}</p>
                </div>
              </div>
            )}
          </div>

          {showWhatShouldIDo && (
            <div className="rounded-xl border border-accent/40 bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span aria-hidden>🎯</span>
                  What should I do?
                </h3>
                <CopyButton label="Copy" getText={() => formatWhatShouldIDo(analysis)} />
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-foreground">
                {analysis.whatUserShouldDo.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          )}

          {showWhatYouGet && (
            <div
              className={`rounded-xl border p-4 ${
                analysis.whatUserGets.identified
                  ? "border-accent/40 bg-background"
                  : "border-notice-border bg-notice-bg"
              }`}
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span aria-hidden>🎁</span>
                What do I get?
              </h3>
              <p
                className={`mt-2 text-sm ${
                  analysis.whatUserGets.identified ? "text-foreground" : "text-notice"
                }`}
              >
                {analysis.whatUserGets.identified
                  ? analysis.whatUserGets.description
                  : "The exact resource isn't clear from the available content."}
              </p>
            </div>
          )}

          {analysis.keyTakeaways.length > 0 && (
            <Section
              icon="🧠"
              title="Key takeaways"
              action={<CopyButton label="Copy" getText={() => formatKeyTakeaways(analysis)} />}
            >
              <ul className="list-inside list-disc space-y-1">
                {analysis.keyTakeaways.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </Section>
          )}

          {resourceGroups.length > 0 && (
            <Section
              icon="🔗"
              title="Resources"
              action={<CopyButton label="Copy" getText={() => formatResources(analysis)} />}
            >
              <div className="space-y-3">
                {resourceGroups.map(([label, items]) => (
                  <div key={label}>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <Chips items={[...items]} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {analysis.technologies.length > 0 && (
            <Section icon="🛠" title="Technologies">
              <Chips items={analysis.technologies} />
            </Section>
          )}

          {explainPanel.status !== "idle" && (
            <Section icon="💡" title="Explained simply">
              {explainPanel.status === "loading" && <p>Simplifying…</p>}
              {explainPanel.status === "error" && <p className="text-danger">{explainPanel.message}</p>}
              {explainPanel.status === "done" && (
                <div className="space-y-2">
                  <p>{explainPanel.data.overview}</p>
                  {explainPanel.data.terms.length > 0 && (
                    <ul className="space-y-1">
                      {explainPanel.data.terms.map((t, i) => (
                        <li key={i}>
                          <span className="font-medium text-foreground">{t.term}:</span> {t.simple}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Section>
          )}

          {analysis.actionItems.length > 0 && (
            <Section
              icon="📋"
              title="Action items"
              action={<CopyButton label="Copy" getText={() => formatActionItems(analysis)} />}
            >
              <ul className="space-y-1">
                {analysis.actionItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden>☐</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {stepsPanel.status !== "idle" && (
            <Section icon="🔢" title="Turned into steps">
              {stepsPanel.status === "loading" && <p>Structuring…</p>}
              {stepsPanel.status === "error" && <p className="text-danger">{stepsPanel.message}</p>}
              {stepsPanel.status === "done" && (
                <ol className="list-inside list-decimal space-y-1">
                  {stepsPanel.data.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </Section>
          )}

          {content.links.length > 0 && (
            <Section icon="📎" title="Links found">
              <ul className="list-inside list-disc space-y-1">
                {content.links.map((link) => (
                  <li key={link} className="break-all">
                    {link}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {analysis.contentNotes.length > 0 && (
            <Section icon="⚠️" title="Content notes">
              <ul className="space-y-1.5">
                {analysis.contentNotes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded border border-notice-border bg-notice-bg px-1.5 py-0.5 text-[10px] font-medium uppercase text-notice">
                      {note.kind === "direct" ? "Stated" : note.kind === "inferred" ? "Inferred" : "AI read"}
                    </span>
                    <span>{note.note}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <CopyButton label="Copy full analysis" getText={() => formatFullAnalysis(content, analysis)} />
            <Button
              type="button"
              variant="secondary"
              onClick={handleExplainSimply}
              disabled={explainPanel.status === "loading"}
            >
              {explainPanel.status === "loading" ? "Simplifying…" : "Explain simply"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleTurnIntoSteps}
              disabled={stepsPanel.status === "loading"}
            >
              {stepsPanel.status === "loading" ? "Structuring…" : "Turn into steps"}
            </Button>
          </div>
        </>
      )}

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
          Analyze another link
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Retrieved via: {retrieval === "retrieved" ? "Instagram (public page)" : "what you pasted"}.
        Nothing from this analysis is saved.
      </p>
    </div>
  );
}
