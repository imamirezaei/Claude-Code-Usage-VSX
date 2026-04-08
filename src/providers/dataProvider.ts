/**
 * Orchestrates all data sources with priority-based merging.
 * Priority: diagnostics > file > api > cached state
 */
import * as vscode from "vscode";
import { UsageData, emptyUsageData } from "../models/usageData";
import { DiagnosticsChannelProvider } from "./diagnosticsChannel";
import { FileWatcherProvider } from "./fileWatcher";
import { BootstrapFetchResult, bootstrapFetch } from "./bootstrapApi";
import { getConfig } from "../config";
import { logInfo, logWarn } from "./outputChannel";

const STATE_KEY = "claudeUsage.lastData";

type DataChangeCallback = (data: UsageData) => void;

export class DataProvider {
  private static readonly BACKGROUND_POLL_MS = 5 * 60 * 1000;
  private current: UsageData = emptyUsageData();
  private diagnostics: DiagnosticsChannelProvider;
  private fileWatcher: FileWatcherProvider;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private backgroundPollTimer: ReturnType<typeof setTimeout> | null = null;
  private backgroundPollBlockedUntil = 0;
  private listeners: DataChangeCallback[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.diagnostics = new DiagnosticsChannelProvider((data) =>
      this.mergeUpdate(data)
    );
    this.fileWatcher = new FileWatcherProvider((data) => this.mergeUpdate(data));
  }

  async start(): Promise<void> {
    // Restore last known state immediately so the status bar shows something
    this.loadPersistedState();
    if (this.current.session || this.current.weekly) {
      this.notify();
    }

    // Start passive watchers
    this.diagnostics.start();
    this.fileWatcher.start();

    // Bootstrap API call for fresh data
    const fresh = await bootstrapFetch();
    this.applyBootstrapResult(fresh, "startup");

    // Periodic refresh for countdown timer (doesn't re-fetch, just repaints)
    this.startRefreshTimer();
    this.scheduleBackgroundPoll(DataProvider.BACKGROUND_POLL_MS);
  }

  stop(): void {
    this.diagnostics.stop();
    this.fileWatcher.stop();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.backgroundPollTimer) {
      clearTimeout(this.backgroundPollTimer);
      this.backgroundPollTimer = null;
    }
  }

  getData(): UsageData {
    return this.current;
  }

  onChange(callback: DataChangeCallback): void {
    this.listeners.push(callback);
  }

  async manualRefresh(): Promise<void> {
    const fresh = await bootstrapFetch();
    this.applyBootstrapResult(fresh, "manual refresh");
  }

  private mergeUpdate(incoming: UsageData): void {
    const sourcePriority: Record<UsageData["source"], number> = {
      diagnostics: 5,
      oauth: 4,
      api: 3,
      file: 2,
      cache: 1,
    };

    const incomingPriority = sourcePriority[incoming.source];
    const currentPriority = sourcePriority[this.current.source];

    // Always accept if data is newer, or if from higher-priority source
    if (
      incoming.fetchedAt >= this.current.fetchedAt ||
      incomingPriority > currentPriority
    ) {
      // Merge: prefer incoming fields but fall back to current if incoming has nulls
      this.current = {
        session: incoming.session ?? this.current.session,
        weekly: incoming.weekly ?? this.current.weekly,
        fetchedAt: incoming.fetchedAt,
        source: incoming.source,
        state: "ready",
        message: undefined,
      };

      this.persistState();
      this.notify();
    }
  }

  private startRefreshTimer(): void {
    const { refreshInterval } = getConfig();
    this.refreshTimer = setInterval(() => {
      // Re-notify listeners so countdowns repaint — no new network call
      this.notify();
    }, refreshInterval * 1000);
  }

  private persistState(): void {
    this.context.globalState.update(STATE_KEY, this.current);
  }

  private loadPersistedState(): void {
    const saved = this.context.globalState.get<UsageData>(STATE_KEY);
    if (saved) {
      this.current = {
        ...saved,
        source: "cache",
        state: "ready",
        message: "Showing cached usage until a fresh sample arrives.",
      };
    }
  }

  private notify(): void {
    this.normalizeExpiredWindows();
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }

  private applyBootstrapResult(
    result: BootstrapFetchResult,
    trigger: "startup" | "manual refresh" | "background poll"
  ): void {
    this.applyRetryAfter(result, trigger);

    if (result.data) {
      logInfo(`Bootstrap usage fetch succeeded during ${trigger} via ${result.data.source}.`);
      this.mergeUpdate(result.data);
      return;
    }

    for (const issue of result.issues) {
      logWarn(issue);
    }

    if (!this.current.session && !this.current.weekly) {
      this.current = {
        ...this.current,
        state: "error",
        message: this.buildFailureMessage(result.issues),
      };
      this.notify();
      return;
    }

    if (this.current.state !== "ready") {
      this.current = {
        ...this.current,
        state: "ready",
        message: "Showing cached usage. Open Claude Usage output for refresh errors.",
      };
      this.notify();
    }
  }

  private normalizeExpiredWindows(): void {
    const now = Date.now();
    let changed = false;
    let session = this.current.session;
    let weekly = this.current.weekly;

    if (session && session.resetAt <= now && session.percent !== 0) {
      session = { ...session, percent: 0 };
      changed = true;
    }

    if (weekly && weekly.resetAt <= now && weekly.percent !== 0) {
      weekly = { ...weekly, percent: 0 };
      changed = true;
    }

    if (!changed) {
      return;
    }

    this.current = {
      ...this.current,
      session,
      weekly,
    };
    this.persistState();
  }

  private scheduleBackgroundPoll(delayMs: number): void {
    if (this.backgroundPollTimer) {
      clearTimeout(this.backgroundPollTimer);
    }

    this.backgroundPollTimer = setTimeout(async () => {
      const waitMs = this.backgroundPollBlockedUntil - Date.now();
      if (waitMs > 0) {
        this.scheduleBackgroundPoll(waitMs);
        return;
      }

      const fresh = await bootstrapFetch();
      this.applyBootstrapResult(fresh, "background poll");
      this.scheduleBackgroundPoll(DataProvider.BACKGROUND_POLL_MS);
    }, Math.max(1000, delayMs));
  }

  private applyRetryAfter(
    result: BootstrapFetchResult,
    trigger: "startup" | "manual refresh" | "background poll"
  ): void {
    if (!result.retryAfterMs || result.retryAfterMs <= 0) {
      return;
    }

    this.backgroundPollBlockedUntil = Date.now() + result.retryAfterMs;
    logWarn(
      `Usage polling received Retry-After during ${trigger}; pausing background fetches for ${Math.ceil(
        result.retryAfterMs / 1000
      )}s.`
    );
  }

  private buildFailureMessage(issues: string[]): string {
    const firstIssue = issues.find((issue) => issue.trim().length > 0);
    return firstIssue
      ? `${firstIssue} Open the "Claude Usage" output for details.`
      : 'No usage source returned data. Open the "Claude Usage" output for details.';
  }
}
