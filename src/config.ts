import * as vscode from "vscode";

export type DisplayMode = "session" | "weekly" | "both" | "auto";

export interface ExtensionConfig {
  displayMode: DisplayMode;
  warningThreshold: number;
  criticalThreshold: number;
  refreshInterval: number;
  showCountdown: boolean;
  notificationsEnabled: boolean;
}

const SECTION = "claudeUsage";

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    displayMode: cfg.get<DisplayMode>("displayMode", "session"),
    warningThreshold: cfg.get<number>("warningThreshold", 70),
    criticalThreshold: cfg.get<number>("criticalThreshold", 90),
    refreshInterval: cfg.get<number>("refreshInterval", 30),
    showCountdown: cfg.get<boolean>("showCountdown", true),
    notificationsEnabled: cfg.get<boolean>("notificationsEnabled", true),
  };
}

export function onConfigChange(
  handler: () => void,
  disposables: vscode.Disposable[]
): void {
  disposables.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        handler();
      }
    })
  );
}
