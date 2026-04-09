import * as vscode from "vscode";
import { DataProvider } from "./providers/dataProvider";
import { StatusBarManager } from "./ui/statusBar";
import { showDetailsQuickPick } from "./ui/quickPick";
import { checkAndNotify } from "./ui/notifications";
import { getConfig, onConfigChange } from "./config";
import { emptyNotificationState } from "./models/usageData";
import { revealOutputChannel } from "./providers/outputChannel";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const dataProvider = new DataProvider(context);
  const statusBar = new StatusBarManager();
  const notificationState = emptyNotificationState();

  // Initial render
  statusBar.update(dataProvider.getData(), getConfig());

  // Re-render whenever data or config changes
  dataProvider.onChange((data) => {
    const config = getConfig();
    statusBar.update(data, config);
    checkAndNotify(data, config, notificationState);
  });

  onConfigChange(() => {
    statusBar.update(dataProvider.getData(), getConfig());
  }, context.subscriptions);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeUsage.refresh", async () => {
      await dataProvider.manualRefresh();
    }),

    vscode.commands.registerCommand("claudeUsage.showDetails", async () => {
      const config = getConfig();
      await showDetailsQuickPick(
        dataProvider.getData(),
        config,
        () => dataProvider.manualRefresh(),
        context.extension.id
      );
    }),

    vscode.commands.registerCommand("claudeUsage.switchMode", async () => {
      const modes = ["session", "weekly", "both"] as const;
      const current = getConfig().displayMode;
      const currentIndex = Math.max(0, modes.indexOf(current as (typeof modes)[number]));
      const next = modes[(currentIndex + 1) % modes.length];
      const cfg = vscode.workspace.getConfiguration("claudeUsage");
      await cfg.update("displayMode", next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Claude Usage: mode → "${next}"`, 3000);
    }),

    vscode.commands.registerCommand("claudeUsage.openOutput", () => {
      revealOutputChannel();
    })
  );

  // Register disposables
  context.subscriptions.push({
    dispose: () => {
      dataProvider.stop();
      statusBar.dispose();
    },
  });

  // Start data collection (async, non-blocking)
  dataProvider.start().catch((err) => {
    console.error("[claude-usage] Failed to start data provider:", err);
  });
}

export function deactivate(): void {
  // Cleanup handled via disposables registered in activate()
}
