import * as vscode from "vscode";
import { UsageData } from "../models/usageData";
import { NotificationState } from "../models/usageData";
import { ExtensionConfig } from "../config";
import { formatCountdown } from "../utils/time";

export function checkAndNotify(
  data: UsageData,
  config: ExtensionConfig,
  state: NotificationState
): void {
  if (!config.notificationsEnabled) {
    return;
  }

  checkWindow(
    "Session",
    data.session,
    config,
    {
      warnSent: state.sessionWarningSent,
      criticalSent: state.sessionCriticalSent,
    },
    (sent) => {
      state.sessionWarningSent = sent.warnSent ?? state.sessionWarningSent;
      state.sessionCriticalSent = sent.criticalSent ?? state.sessionCriticalSent;
    }
  );

  checkWindow(
    "Weekly",
    data.weekly,
    config,
    {
      warnSent: state.weeklyWarningSent,
      criticalSent: state.weeklyCriticalSent,
    },
    (sent) => {
      state.weeklyWarningSent = sent.warnSent ?? state.weeklyWarningSent;
      state.weeklyCriticalSent = sent.criticalSent ?? state.weeklyCriticalSent;
    }
  );
}

function checkWindow(
  label: string,
  window: { percent: number; resetAt: number } | null,
  config: ExtensionConfig,
  flags: { warnSent: boolean; criticalSent: boolean },
  setFlags: (f: Partial<typeof flags>) => void
): void {
  if (!window) {
    return;
  }

  const { percent, resetAt } = window;
  const countdown = formatCountdown(resetAt);

  if (percent >= config.criticalThreshold && !flags.criticalSent) {
    vscode.window
      .showWarningMessage(
        `Claude ${label} usage at ${percent}% — resets in ${countdown}.`,
        "View Usage"
      )
      .then((choice) => {
        if (choice === "View Usage") {
          vscode.commands.executeCommand("claudeUsage.showDetails");
        }
      });
    setFlags({ criticalSent: true });
  } else if (percent >= config.warningThreshold && !flags.warnSent) {
    vscode.window.setStatusBarMessage(
      `$(warning) Claude ${label}: ${percent}% used, resets in ${countdown}`,
      8000
    );
    setFlags({ warnSent: true });
  }

  // Reset flags when usage drops back below warning threshold (new window)
  if (percent < config.warningThreshold) {
    setFlags({ warnSent: false, criticalSent: false });
  }
}
