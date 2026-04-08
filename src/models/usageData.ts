export interface RateLimitWindow {
  /** Usage percentage 0–100 */
  percent: number;
  /** Absolute timestamp (ms) when this window resets */
  resetAt: number;
  /** Raw tokens/requests used, if available */
  used?: number;
  /** Raw tokens/requests limit, if available */
  limit?: number;
}

export interface UsageData {
  session: RateLimitWindow | null;
  weekly: RateLimitWindow | null;
  /** When this data was last fetched (ms epoch) */
  fetchedAt: number;
  /** Which provider produced this data */
  source: "diagnostics" | "file" | "api" | "oauth" | "cache";
  /** Current availability state for UI fallback messaging */
  state: "loading" | "ready" | "error";
  /** Human-readable status for loading/error conditions */
  message?: string;
}

export interface NotificationState {
  sessionWarningSent: boolean;
  sessionCriticalSent: boolean;
  weeklyWarningSent: boolean;
  weeklyCriticalSent: boolean;
}

export function emptyUsageData(): UsageData {
  return {
    session: null,
    weekly: null,
    fetchedAt: 0,
    source: "cache",
    state: "loading",
    message: "Waiting for Claude Code usage data...",
  };
}

export function emptyNotificationState(): NotificationState {
  return {
    sessionWarningSent: false,
    sessionCriticalSent: false,
    weeklyWarningSent: false,
    weeklyCriticalSent: false,
  };
}
