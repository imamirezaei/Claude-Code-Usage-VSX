/**
 * Passively monitors Claude Code's own HTTP traffic via Node.js diagnostics_channel.
 * Zero extra API calls — reads responses Claude Code already makes.
 */
import * as dc from "diagnostics_channel";
import { UsageData, RateLimitWindow } from "../models/usageData";
import { logInfo, logWarn } from "./outputChannel";

type UpdateCallback = (data: UsageData) => void;

interface HttpResponseMessage {
  request?: { path?: string; host?: string };
  response?: { statusCode?: number };
  body?: Buffer | string;
}

/** Known Claude usage endpoint path fragments */
const USAGE_PATH_PATTERNS = [
  "/api/oauth/usage",
  "/api/usage",
  "/usage",
  "rate_limit",
  "rate-limit",
];

export class DiagnosticsChannelProvider {
  private subscriber: ((msg: unknown, name: string | symbol) => void) | null = null;
  private channel: dc.Channel | null = null;

  constructor(private onUpdate: UpdateCallback) {}

  start(): void {
    // diagnostics_channel may not exist in all runtimes — guard defensively
    if (typeof dc.subscribe !== "function") {
      return;
    }

    this.subscriber = (message: unknown, _name: string | symbol) => {
      this.handleMessage(message as HttpResponseMessage);
    };

    try {
      dc.subscribe("http.client.response", this.subscriber);
      dc.subscribe("undici:response:headers", this.subscriber);
      logInfo(
        "Subscribed to diagnostics_channel sources (http.client.response, undici:response:headers)."
      );
    } catch {
      // Channel not available in this environment — silent fail, fallback providers take over
      logWarn("diagnostics_channel subscriptions are unavailable in this extension host.");
    }
  }

  stop(): void {
    if (this.subscriber) {
      try {
        dc.unsubscribe("http.client.response", this.subscriber);
        dc.unsubscribe("undici:response:headers", this.subscriber);
      } catch {
        // ignore
      }
      this.subscriber = null;
    }
  }

  private handleMessage(message: HttpResponseMessage): void {
    const path = message?.request?.path ?? "";
    if (!this.isUsagePath(path)) {
      return;
    }

    const body = message?.body;
    if (!body) {
      logWarn(
        `Diagnostics event matched usage path "${path}" but did not include a response body.`
      );
      return;
    }

    try {
      const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
      const parsed = JSON.parse(text);
      const data = this.parseUsagePayload(parsed);
      if (data) {
        this.onUpdate(data);
      }
    } catch {
      // Malformed JSON — ignore
    }
  }

  private isUsagePath(path: string): boolean {
    return USAGE_PATH_PATTERNS.some((p) => path.includes(p));
  }

  private parseUsagePayload(payload: Record<string, unknown>): UsageData | null {
    const rateLimits =
      payload["rate_limits"] && typeof payload["rate_limits"] === "object"
        ? (payload["rate_limits"] as Record<string, unknown>)
        : null;

    const session =
      this.extractOfficialWindow(
        payload["five_hour"] ??
          payload["fiveHour"] ??
          rateLimits?.["five_hour"] ??
          payload["session"] ??
          payload["sessionUsage"] ??
          null
      ) ??
      this.extractWindow(payload["session"] ?? payload["sessionUsage"] ?? payload);

    const weekly =
      this.extractOfficialWindow(
        payload["seven_day"] ??
          payload["sevenDay"] ??
          rateLimits?.["seven_day"] ??
          payload["weekly"] ??
          payload["weeklyUsage"] ??
          null
      ) ?? this.extractWindow(payload["weekly"] ?? payload["weeklyUsage"] ?? null);

    if (!session && !weekly) {
      return null;
    }

    return {
      session,
      weekly,
      fetchedAt: Date.now(),
      source: "diagnostics",
      state: "ready",
    };
  }

  private extractWindow(raw: unknown): RateLimitWindow | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const obj = raw as Record<string, unknown>;

    const percent =
      typeof obj["percent"] === "number"
        ? obj["percent"]
        : typeof obj["percentUsed"] === "number"
        ? obj["percentUsed"]
        : typeof obj["used"] === "number" && typeof obj["limit"] === "number" && obj["limit"] > 0
        ? Math.round((obj["used"] as number / obj["limit"] as number) * 100)
        : null;

    const resetAt =
      typeof obj["resetAt"] === "number"
        ? obj["resetAt"]
        : typeof obj["reset_at"] === "number"
        ? obj["reset_at"]
        : typeof obj["resetAt"] === "string"
        ? new Date(obj["resetAt"] as string).getTime()
        : typeof obj["reset_at"] === "string"
        ? new Date(obj["reset_at"] as string).getTime()
        : null;

    if (percent === null || resetAt === null || isNaN(resetAt)) {
      return null;
    }

    return {
      percent: Math.min(100, Math.max(0, percent)),
      resetAt,
      used: typeof obj["used"] === "number" ? obj["used"] : undefined,
      limit: typeof obj["limit"] === "number" ? obj["limit"] : undefined,
    };
  }

  private extractOfficialWindow(raw: unknown): RateLimitWindow | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const obj = raw as Record<string, unknown>;
    const utilization =
      typeof obj["utilization"] === "number"
        ? obj["utilization"]
        : typeof obj["used_percentage"] === "number"
        ? obj["used_percentage"]
        : null;

    const percent =
      utilization === null
        ? null
        : utilization <= 1
        ? Math.round(utilization * 100)
        : Math.round(utilization);

    const resetAt =
      typeof obj["resets_at"] === "string"
        ? new Date(obj["resets_at"]).getTime()
        : typeof obj["resets_at"] === "number"
        ? obj["resets_at"]
        : typeof obj["resetAt"] === "string"
        ? new Date(obj["resetAt"]).getTime()
        : typeof obj["resetAt"] === "number"
        ? obj["resetAt"]
        : null;

    if (percent === null || resetAt === null || isNaN(resetAt)) {
      return null;
    }

    return {
      percent: Math.min(100, Math.max(0, percent)),
      resetAt,
    };
  }
}
