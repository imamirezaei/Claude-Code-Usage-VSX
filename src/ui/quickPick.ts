import * as vscode from "vscode";
import { UsageData, RateLimitWindow } from "../models/usageData";
import { formatCountdown, formatResetDateTime } from "../utils/time";
import { DisplayMode, ExtensionConfig } from "../config";
import { buildPixelBar } from "./pixelStyle";

const BAR_LENGTH = 10;

function windowItem(
  label: string,
  window: RateLimitWindow,
  config: ExtensionConfig
): vscode.QuickPickItem {
  return {
    label: `$(clock) ${label}`,
    description: `${buildPixelBar(window.percent, config, BAR_LENGTH)} ${window.percent}%`,
    detail: `Resets in ${formatCountdown(window.resetAt)}  ·  ${formatResetDateTime(window.resetAt)}`,
  };
}

const MODE_CYCLE: DisplayMode[] = ["session", "weekly", "both"];

export async function showDetailsQuickPick(
  data: UsageData,
  config: ExtensionConfig,
  onRefresh: () => Promise<void>,
  extensionId: string
): Promise<void> {
  const items: vscode.QuickPickItem[] = [];
  const currentMode = config.displayMode;

  // Usage data items
  if (!data.session && !data.weekly) {
    items.push({
      label:
        data.state === "error"
          ? "$(error) Usage unavailable"
          : "$(warning) No data yet",
      detail:
        data.message ??
        (data.state === "error"
          ? 'Open the "Claude Usage" output for details.'
          : "Waiting for Claude Code to make API calls..."),
    });
  } else {
    if (data.session) {
      items.push(windowItem("Session (5 h)", data.session, config));
    }
    if (data.weekly) {
      items.push(windowItem("Weekly (7 d)", data.weekly, config));
    }
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
  }

  // Actions
  const nextMode = MODE_CYCLE[(MODE_CYCLE.indexOf(currentMode) + 1) % MODE_CYCLE.length];
  items.push({
    label: "$(symbol-enum) Switch display mode",
    description: `Current: ${currentMode}  →  next: ${nextMode}`,
    alwaysShow: true,
  });
  items.push({
    label: "$(refresh) Refresh now",
    description: "Fetch latest usage from API",
    alwaysShow: true,
  });
  items.push({
    label: "$(gear) Open settings",
    description: "claudeUsage.*",
    alwaysShow: true,
  });
  items.push({
    label: "$(output) Open output",
    description: "Claude Usage diagnostics",
    alwaysShow: true,
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: "Claude Usage",
    placeHolder: "Select an action",
    matchOnDescription: false,
    matchOnDetail: false,
  });

  if (!pick) {
    return;
  }

  if (pick.label.includes("Switch display mode")) {
    const config = vscode.workspace.getConfiguration("claudeUsage");
    await config.update("displayMode", nextMode, vscode.ConfigurationTarget.Global);
    vscode.window.setStatusBarMessage(`Claude Usage: mode set to "${nextMode}"`, 3000);
  } else if (pick.label.includes("Refresh now")) {
    vscode.window.setStatusBarMessage("$(sync~spin) Claude Usage: refreshing...", 2000);
    await onRefresh();
    vscode.window.setStatusBarMessage("$(check) Claude Usage: refreshed", 2000);
  } else if (pick.label.includes("Open settings")) {
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      `@ext:${extensionId}`
    );
  } else if (pick.label.includes("Open output")) {
    vscode.commands.executeCommand("claudeUsage.openOutput");
  }
}
