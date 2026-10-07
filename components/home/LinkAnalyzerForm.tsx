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
import type { AnalyzeResponse } from "@/lib/apiTypes";
import { AnalysisResult } from "@/components/home/AnalysisResult";

type FormPhase = "form" | "loading";
type SuccessResult = Extract<AnalyzeResponse, { success: true }>;

function describeFailure(res: Response, data: AnalyzeResponse): string {
  if (res.status === 429) return "Too many requests — please wait a moment and try again.";
  if (!data.success && data.error) return data.error.message;
  return "Something went wrong. Please try again.";
}

export function LinkAnalyzerForm() {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [transcript, setTranscript] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [insufficientNotice, setInsufficientNotice] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>("");
  const [phase, setPhase] = useState<FormPhase>("form");
  const [result, setResult] = useState<SuccessResult | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  async function requestAnalysis() {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        caption: caption.trim() || undefined,
        transcript: transcript.trim() || undefined,
      }),
    });
    const data: AnalyzeResponse = await res.json();
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
    setPhase("loading");
    setLoadingStage("Retrieving available content…");
    const stageTimer = window.setTimeout(() => setLoadingStage("Analyzing with AI…"), 900);

    try {
      const { res, data } = await requestAnalysis();

      if (!res.ok || !data.success) {
        setRequestError(describeFailure(res, data));
        setPhase("form");
        return;
      }

      if (!data.sufficientContent) {
        setInsufficientNotice(true);
        setShowAdvanced(true);
        setPhase("form");
        return;
      }

      setResult(data);
    } catch {
      setRequestError("We couldn't reach the server. Check your connection and try again.");
      setPhase("form");
    } finally {
      window.clearTimeout(stageTimer);
    }
  }

  async function handleReanalyze() {
    setReanalyzing(true);
    setReanalyzeError(null);

    try {
      const { res, data } = await requestAnalysis();

      if (!res.ok || !data.success) {
        setReanalyzeError(describeFailure(res, data));
        return;
      }
      if (!data.sufficientContent) {
        setReanalyzeError("That link no longer has enough content to analyze.");
        return;
      }

      setResult(data);
    } catch {
      setReanalyzeError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setReanalyzing(false);
    }
  }

  function handleReset() {
    setUrl("");
    setCaption("");
    setTranscript("");
    setShowAdvanced(false);
    setFieldError(null);
    setRequestError(null);
    setInsufficientNotice(false);
    setPhase("form");
    setResult(null);
    setReanalyzeError(null);
  }

  if (result) {
    return (
      <AnalysisResult
        content={result.content}
        analysis={result.analysis}
        retrieval={result.retrieval}
        aiError={result.aiError}
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
          {phase === "loading" ? loadingStage || "Analyzing…" : "Analyze"}
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
        Understand the content, extract the useful stuff, and see what the creator is asking you
        to do.
      </p>

      {insufficientNotice && (
        <div className="mt-4 rounded-lg border border-notice-border bg-notice-bg px-4 py-3 text-sm text-notice">
          We couldn&apos;t retrieve enough information from this Instagram post to fully analyze
          it. Paste the caption or transcript below, then analyze again.
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? "− Hide deeper analysis options" : "+ Need a deeper analysis?"}
        </button>

        {showAdvanced && (
          <div className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">
              Instagram often doesn&apos;t expose a Reel&apos;s full caption or transcript
              publicly. Paste either below to get a deeper analysis.
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
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {caption.length}/{MAX_CAPTION_LENGTH}
              </p>
            </div>
            <div>
              <label htmlFor="ig-transcript" className="mb-1 block text-sm font-medium">
                Transcript
              </label>
              <Textarea
                id="ig-transcript"
                rows={4}
                maxLength={MAX_TRANSCRIPT_LENGTH}
                placeholder="Paste the spoken transcript or on-screen text…"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {transcript.length}/{MAX_TRANSCRIPT_LENGTH}
              </p>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
