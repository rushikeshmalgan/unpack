"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  MAX_CAPTION_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  describeUrlError,
  validateInstagramUrl,
} from "@/lib/validation";
import type { UnpackResponse } from "@/lib/apiTypes";
import { ResultsView } from "@/components/home/ResultsView";

type FormPhase = "form" | "loading";
type Mode = "exact" | "explore";
type SuccessResult = Extract<UnpackResponse, { success: true; status: "ok" }>;

function describeFailure(res: Response, data: UnpackResponse): string {
  if (res.status === 429) return "Too many requests — please wait a moment and try again.";
  if (!data.success && data.error) return data.error.message;
  return "Something went wrong. Please try again.";
}

export function LinkAnalyzerForm() {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [transcript, setTranscript] = useState("");
  const [comments, setComments] = useState("");
  const [onScreenText, setOnScreenText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [insufficientNotice, setInsufficientNotice] = useState(false);
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<string>("");
  const [phase, setPhase] = useState<FormPhase>("form");
  const [mode, setMode] = useState<Mode>("exact");
  const [result, setResult] = useState<SuccessResult | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  async function requestUnpack(requestMode: Mode) {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        caption: caption.trim() || undefined,
        transcript: transcript.trim() || undefined,
        comments: comments.trim() || undefined,
        onScreenText: onScreenText.trim() || undefined,
        mode: requestMode,
      }),
    });
    const data: UnpackResponse = await res.json();
    return { res, data };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const validated = validateInstagramUrl(url);
    if (!validated.ok) {
      setFieldError(describeUrlError(validated.reason));
      return;
    }

    setFieldError(null);
    setRequestError(null);
    setInsufficientNotice(false);
    setDegradedNotice(null);
    setPhase("loading");
    setLoadingStage("Reading reel…");
    const stage2 = window.setTimeout(() => setLoadingStage("Understanding…"), 1200);
    const stage3 = window.setTimeout(() => setLoadingStage("Searching for real links…"), 4000);

    try {
      const { res, data } = await requestUnpack(mode);

      if (!res.ok || !data.success) {
        setRequestError(describeFailure(res, data));
        setPhase("form");
        return;
      }

      if (data.status === "insufficient") {
        setInsufficientNotice(true);
        setShowAdvanced(true);
        setPhase("form");
        return;
      }

      if (data.status === "ai_error") {
        setDegradedNotice(data.error.message);
        setPhase("form");
        return;
      }

      setResult(data);
    } catch {
      setRequestError("We couldn't reach the server. Check your connection and try again.");
      setPhase("form");
    } finally {
      window.clearTimeout(stage2);
      window.clearTimeout(stage3);
    }
  }

  async function runWithMode(requestMode: Mode) {
    setReanalyzing(true);
    setReanalyzeError(null);

    try {
      const { res, data } = await requestUnpack(requestMode);

      if (!res.ok || !data.success || data.status !== "ok") {
        setReanalyzeError(!res.ok || !data.success ? describeFailure(res, data) : "Couldn't switch modes right now.");
        return;
      }

      setMode(requestMode);
      setResult(data);
    } catch {
      setReanalyzeError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setReanalyzing(false);
    }
  }

  function handleReanalyze() {
    void runWithMode(mode);
  }

  function handleToggleExplore() {
    void runWithMode(mode === "exact" ? "explore" : "exact");
  }

  function handleReset() {
    setUrl("");
    setCaption("");
    setTranscript("");
    setComments("");
    setOnScreenText("");
    setShowAdvanced(false);
    setFieldError(null);
    setRequestError(null);
    setInsufficientNotice(false);
    setDegradedNotice(null);
    setPhase("form");
    setMode("exact");
    setResult(null);
    setReanalyzeError(null);
  }

  if (result) {
    return (
      <ResultsView
        result={result.result}
        mode={mode}
        onToggleExplore={handleToggleExplore}
        onReanalyze={handleReanalyze}
        onReset={handleReset}
        reanalyzing={reanalyzing}
        reanalyzeError={reanalyzeError}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="ig-url" className="sr-only">
            Instagram Reel or Post link
          </label>
          <Input
            id="ig-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="Paste link here..."
            value={url}
            invalid={!!fieldError}
            onChange={(e) => {
              setUrl(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            disabled={phase === "loading"}
            aria-describedby={fieldError ? "ig-url-error" : undefined}
          />
        </div>
        <Button type="submit" disabled={phase === "loading"} className="sm:w-auto">
          {phase === "loading" ? loadingStage || "Finding links…" : "Find the links"}
        </Button>
      </div>

      {fieldError && (
        <p id="ig-url-error" role="alert" className="mt-2 text-sm text-danger">
          {fieldError}
        </p>
      )}

      {requestError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {requestError}
        </p>
      )}

      <p className="mt-3 text-sm text-muted-foreground">
        We work out what the reel points to — videos, tools, repos, books, places, and more —
        and find the real links. No following, no commenting, no waiting for a DM.
      </p>

      {insufficientNotice && (
        <div className="mt-4 rounded-lg border border-notice-border bg-notice-bg px-4 py-3 text-sm text-notice">
          We couldn&apos;t retrieve enough information from this Instagram post. Paste the
          caption, transcript, or on-screen text below, then try again.
        </div>
      )}

      {degradedNotice && (
        <div className="mt-4 rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
          {degradedNotice}
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? "− Hide manual input" : "+ Paste caption / transcript / comments"}
        </button>

        {showAdvanced && (
          <div className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">
              Instagram often doesn&apos;t expose a Reel&apos;s caption, spoken words, or on-screen
              text publicly — paste what you can below for better results.
            </p>
            <div>
              <label htmlFor="ig-caption" className="mb-1 block text-sm font-medium">
                Caption
              </label>
              <Textarea
                id="ig-caption"
                rows={3}
                maxLength={MAX_CAPTION_LENGTH}
                placeholder="Paste the post caption…"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ig-transcript" className="mb-1 block text-sm font-medium">
                Transcript
              </label>
              <Textarea
                id="ig-transcript"
                rows={3}
                maxLength={MAX_TRANSCRIPT_LENGTH}
                placeholder="Paste the spoken transcript…"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ig-onscreen" className="mb-1 block text-sm font-medium">
                On-screen text
              </label>
              <Textarea
                id="ig-onscreen"
                rows={2}
                maxLength={MAX_CAPTION_LENGTH}
                placeholder="Any titles, names, or URLs shown on screen…"
                value={onScreenText}
                onChange={(e) => setOnScreenText(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ig-comments" className="mb-1 block text-sm font-medium">
                Top comments
              </label>
              <Textarea
                id="ig-comments"
                rows={2}
                maxLength={MAX_CAPTION_LENGTH}
                placeholder="Pinned or top comments, if they mention the links…"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
