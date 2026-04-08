import * as vscode from "vscode";
import { UsageData, RateLimitWindow } from "../models/usageData";
import { ExtensionConfig } from "../config";
import { formatCountdown, formatResetDateTime } from "../utils/time";
import { buildPixelBar, getWindowTone } from "./pixelStyle";

const BAR_LENGTH = 8;

function windowSection(
  label: string,
  window: RateLimitWindow,
  config: ExtensionConfig
): string {
  const bar = buildPixelBar(window.percent, config, BAR_LENGTH);
  const pct = `${window.percent}%`.padStart(4);
  const countdown = formatCountdown(window.resetAt);
  const resetFull = formatResetDateTime(window.resetAt);
  const tone = getWindowTone(window, config);
  const toneLabel =
    tone === "critical" ? "Critical" : tone === "warning" ? "Warm" : "Cool";

  const lines = [
    `**${label}**`,
    `${bar}  **${pct.trim()}**  ·  ${toneLabel}`,
    `Resets in **${countdown}** (${resetFull})`,
  ];

  if (window.used !== undefined && window.limit !== undefined) {
    lines.push(`${window.used.toLocaleString()} / ${window.limit.toLocaleString()} tokens`);
  }

  return lines.join("\n\n");
}

export function buildTooltip(
  data: UsageData,
  config: ExtensionConfig
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = true;
  md.supportHtml = false;

  const sections: string[] = ["## Claude Usage"];

  if (!data.session && !data.weekly) {
    if (data.state === "error") {
      sections.push(`_Usage unavailable._\n\n${data.message ?? ""}`.trim());
      sections.push('Open the "Claude Usage" output for detailed diagnostics.');
    } else {
      sections.push("_No data yet. Waiting for Claude Code activity..._");
    }
  } else {
    if (data.session) {
      sections.push(windowSection("Session (5 h)", data.session, config));
    }
    if (data.weekly) {
      sections.push(windowSection("Weekly (7 d)", data.weekly, config));
    }
  }

  const age = data.fetchedAt
    ? `_Updated ${formatCountdown(data.fetchedAt + 60_000)} ago · ${data.source}_`
    : "";
  if (age) {
    sections.push(age);
  }

  sections.push("$(refresh) Click to refresh");

  md.appendMarkdown(sections.join("\n\n---\n\n"));
  return md;
}
