"use client";

import { useState } from "react";

export function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-live="polite"
      className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
