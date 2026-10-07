import type { NormalizedContent } from "@/lib/content/types";
import type { AnalysisResult } from "@/lib/schemas/analysisResult";

export function formatKeyTakeaways(analysis: AnalysisResult): string {
  return analysis.keyTakeaways.map((t) => `- ${t}`).join("\n");
}

export function formatActionItems(analysis: AnalysisResult): string {
  return analysis.actionItems.map((t) => `- [ ] ${t}`).join("\n");
}

export function formatWhatShouldIDo(analysis: AnalysisResult): string {
  return analysis.whatUserShouldDo.map((t) => `- ${t}`).join("\n");
}

export function formatResources(analysis: AnalysisResult): string {
  const groups: [string, string[]][] = [
    ["Websites", analysis.resources.websites],
    ["Tools", analysis.resources.tools],
    ["Courses", analysis.resources.courses],
    ["Books", analysis.resources.books],
    ["Repositories", analysis.resources.repositories],
    ["People", analysis.resources.people],
    ["Companies", analysis.resources.companies],
  ];
  return groups
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => `${label}: ${items.join(", ")}`)
    .join("\n");
}

export function formatFullAnalysis(content: NormalizedContent, analysis: AnalysisResult): string {
  const lines: string[] = [];
  lines.push(`Source: ${content.sourceUrl}`);
  lines.push("");
  lines.push("WHAT IS THIS?");
  lines.push(analysis.summary.tldr);
  lines.push("");

  if (analysis.whatUserShouldDo.length > 0) {
    lines.push("WHAT SHOULD I DO?");
    lines.push(formatWhatShouldIDo(analysis));
    lines.push("");
  }

  if (analysis.cta.detected || analysis.whatUserGets.identified) {
    lines.push("WHAT DO I GET?");
    lines.push(
      analysis.whatUserGets.identified
        ? (analysis.whatUserGets.description ?? "")
        : "The exact resource isn't clear from the available content.",
    );
    lines.push("");
  }

  if (analysis.keyTakeaways.length > 0) {
    lines.push("KEY TAKEAWAYS");
    lines.push(formatKeyTakeaways(analysis));
    lines.push("");
  }

  const resourcesText = formatResources(analysis);
  if (resourcesText) {
    lines.push("RESOURCES");
    lines.push(resourcesText);
    lines.push("");
  }

  if (analysis.technologies.length > 0) {
    lines.push("TECHNOLOGIES");
    lines.push(analysis.technologies.join(", "));
    lines.push("");
  }

  if (analysis.actionItems.length > 0) {
    lines.push("ACTION ITEMS");
    lines.push(formatActionItems(analysis));
    lines.push("");
  }

  if (content.links.length > 0) {
    lines.push("LINKS FOUND");
    lines.push(content.links.join("\n"));
    lines.push("");
  }

  return lines.join("\n").trim();
}
