import { ExtensionConfig } from "../config";
import { RateLimitWindow, UsageData } from "../models/usageData";

export type UsageMood = "loading" | "error" | "calm" | "warning" | "critical";

const FILLED_BLOCK = "▰";
const EMPTY_BLOCK = "▱";
const WARNING_COLOR = "#C3924A";
const CRITICAL_COLOR = "#C1675A";

export function resolveUsageMood(
  data: UsageData,
  config: ExtensionConfig
): UsageMood {
  if (!data.session && !data.weekly) {
    return data.state === "error" ? "error" : "loading";
  }

  const maxPercent = Math.max(data.session?.percent ?? 0, data.weekly?.percent ?? 0);
  if (maxPercent >= config.criticalThreshold) {
    return "critical";
  }
  if (maxPercent >= config.warningThreshold) {
    return "warning";
  }
  return "calm";
}

export function buildPixelBar(
  percent: number,
  config: ExtensionConfig,
  length: number
): string {
  const filled = Math.round((percent / 100) * length);
  const empty = Math.max(0, length - filled);
  const filledGlyph = getFilledGlyph(percent, config);
  return filledGlyph.repeat(filled) + EMPTY_BLOCK.repeat(empty);
}

export function getWindowTone(
  window: RateLimitWindow,
  config: ExtensionConfig
): UsageMood {
  if (window.percent >= config.criticalThreshold) {
    return "critical";
  }
  if (window.percent >= config.warningThreshold) {
    return "warning";
  }
  return "calm";
}

export function getWindowColor(
  window: RateLimitWindow,
  config: ExtensionConfig
): string | undefined {
  if (window.percent >= config.criticalThreshold) {
    return CRITICAL_COLOR;
  }
  if (window.percent >= config.warningThreshold) {
    return WARNING_COLOR;
  }
  return undefined;
}

function getFilledGlyph(percent: number, config: ExtensionConfig): string {
  void percent;
  void config;
  return FILLED_BLOCK;
}
