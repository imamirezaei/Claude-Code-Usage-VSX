import * as vscode from "vscode";
import { UsageData, RateLimitWindow } from "../models/usageData";
import { ExtensionConfig, DisplayMode } from "../config";
import { formatCountdown } from "../utils/time";
import { buildTooltip } from "./tooltip";
import { buildPixelBar, getWindowColor } from "./pixelStyle";

const BAR_LENGTH = 6;

interface StatusSegment {
  text: string;
  color?: string;
}

function formatWindow(
  label: string,
  window: RateLimitWindow,
  config: ExtensionConfig
): StatusSegment {
  const bar = buildPixelBar(window.percent, config, BAR_LENGTH);
  const pct = `${window.percent}%`;
  const countdown = config.showCountdown ? ` · ${formatCountdown(window.resetAt)}` : "";
  return {
    text: `${label}: ${bar} ${pct}${countdown}`,
    color: getWindowColor(window, config),
  };
}

function resolveMode(mode: DisplayMode, data: UsageData): "session" | "weekly" | "both" {
  if (mode === "auto") {
    // Show weekly when session is below 30% — otherwise session dominates
    const sessionPct = data.session?.percent ?? 0;
    return sessionPct < 30 && data.weekly ? "weekly" : "session";
  }
  return mode;
}

export class StatusBarManager {
  private primaryItem: vscode.StatusBarItem;
  private secondaryItem: vscode.StatusBarItem;

  constructor() {
    this.primaryItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.primaryItem.command = "claudeUsage.showDetails";
    this.primaryItem.name = "Claude Usage";
    this.primaryItem.show();

    this.secondaryItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    );
    this.secondaryItem.command = "claudeUsage.showDetails";
    this.secondaryItem.name = "Claude Usage Secondary";
  }

  update(data: UsageData, config: ExtensionConfig): void {
    const tooltip = buildTooltip(data, config);

    if (!data.session && !data.weekly) {
      const isError = data.state === "error";
      this.primaryItem.text = isError ? "$(warning) Claude Usage" : "$(sync~spin) Claude";
      this.primaryItem.tooltip =
        data.message ??
        (isError
          ? 'Claude Usage could not find a working data source. Open the "Claude Usage" output for details.'
          : "Waiting for Claude Code usage data...");
      this.primaryItem.backgroundColor = undefined;
      this.primaryItem.color = undefined;
      this.primaryItem.show();
      this.secondaryItem.hide();
      return;
    }

    const mode = resolveMode(config.displayMode, data);
    const segments: StatusSegment[] = [];

    if ((mode === "session" || mode === "both") && data.session) {
      segments.push(formatWindow("S", data.session, config));
    }
    if ((mode === "weekly" || mode === "both") && data.weekly) {
      segments.push(formatWindow("W", data.weekly, config));
    }

    // Fallback: show whichever is available
    if (segments.length === 0) {
      const available = data.session ?? data.weekly!;
      segments.push(formatWindow("S", available, config));
    }

    this.applySegment(this.primaryItem, segments[0], tooltip);

    if (segments[1]) {
      this.applySegment(this.secondaryItem, segments[1], tooltip);
      this.secondaryItem.show();
    } else {
      this.secondaryItem.hide();
    }
  }

  dispose(): void {
    this.primaryItem.dispose();
    this.secondaryItem.dispose();
  }

  private applySegment(
    item: vscode.StatusBarItem,
    segment: StatusSegment,
    tooltip: vscode.MarkdownString
  ): void {
    item.text = segment.text;
    item.tooltip = tooltip;
    item.backgroundColor = undefined;
    item.color = segment.color;
    item.show();
  }
}
