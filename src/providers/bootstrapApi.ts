/**
 * Single bootstrap API call on activation to get fresh data immediately.
 * Uses Claude Code's OAuth storage first, then falls back to legacy token lookup.
 */
import * as https from "https";
import { IncomingHttpHeaders } from "http";
import { UsageData, RateLimitWindow } from "../models/usageData";
import {
  getClaudeCodeOauthToken,
  getLegacyApiToken,
} from "../utils/credentials";
import { logInfo, logWarn } from "./outputChannel";

const CLAUDE_API_HOST = "api.anthropic.com";
const OAUTH_USAGE_ENDPOINT = "/api/oauth/usage";
const USAGE_ENDPOINTS = ["/api/usage", "/api/organizations/usage"];
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

export interface BootstrapFetchResult {
  data: UsageData | null;
  issues: string[];
  retryAfterMs?: number;
}

export async function bootstrapFetch(): Promise<BootstrapFetchResult> {
  const issues: string[] = [];

  const oauth = await getClaudeCodeOauthToken();
  issues.push(...oauth.issues);

  if (oauth.value) {
    logInfo("Trying Claude Code OAuth usage endpoint.");
    const oauthData = await fetchOauthUsage(oauth.value.accessToken);
    issues.push(...oauthData.issues);
    if (oauthData.data) {
      return oauthData;
    }
  } else {
    logWarn("Claude Code OAuth credentials are unavailable for usage bootstrap.");
  }

  const token = await getLegacyApiToken();
  issues.push(...token.issues);

  if (!token.value) {
    return { data: null, issues };
  }

  logInfo("Trying legacy Claude usage endpoints.");
  for (const endpoint of USAGE_ENDPOINTS) {
    try {
      const data = await fetchLegacyEndpoint(endpoint, token.value);
      if (data) {
        return { data, issues };
      }
      issues.push(`Legacy endpoint ${endpoint} returned no recognizable usage payload.`);
    } catch {
      issues.push(`Legacy endpoint ${endpoint} failed during request processing.`);
    }
  }

  return { data: null, issues };
}

async function fetchOauthUsage(accessToken: string): Promise<BootstrapFetchResult> {
  try {
    const response = await requestJson(OAUTH_USAGE_ENDPOINT, {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": OAUTH_BETA_HEADER,
      "Content-Type": "application/json",
      "User-Agent": "claude-usage-vscode/0.1.0",
    });

    if (response.error) {
      return {
        data: null,
        issues: [`OAuth usage endpoint request failed: ${response.error}`],
      };
    }

    if (response.statusCode !== 200) {
      return {
        data: null,
        issues: [
          `OAuth usage endpoint responded with HTTP ${response.statusCode}.`,
        ],
        retryAfterMs: getRetryAfterMs(response.headers),
      };
    }

    const data = parseOauthUsageResponse(response.payload);
    return data
      ? {
          data,
          issues: [],
        }
      : {
          data: null,
          issues: ["OAuth usage endpoint returned an unrecognized payload shape."],
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      data: null,
      issues: [`OAuth usage endpoint request failed: ${message}`],
    };
  }
}

async function fetchLegacyEndpoint(
  path: string,
  token: string
): Promise<UsageData | null> {
  const response = await requestJson(path, {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "claude-usage-vscode/0.1.0",
  });

  if (response.statusCode !== 200) {
    return null;
  }

  return parseLegacyResponse(response.payload);
}

function requestJson(
  path: string,
  headers: Record<string, string>
): Promise<{
  statusCode: number;
  payload: Record<string, unknown> | null;
  headers: IncomingHttpHeaders;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: CLAUDE_API_HOST,
      path,
      method: "GET",
      headers,
      timeout: 8000,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!body.trim()) {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              payload: null,
            });
            return;
          }

          const parsed = JSON.parse(body);
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            payload:
              parsed && typeof parsed === "object"
                ? (parsed as Record<string, unknown>)
                : null,
          });
        } catch {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            payload: null,
          });
        }
      });
    });

    req.on("error", (error) =>
      resolve({
        statusCode: 0,
        headers: {},
        payload: null,
        error: `${error.name}: ${error.message}`,
      })
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({
        statusCode: 0,
        headers: {},
        payload: null,
        error: `Request to https://${CLAUDE_API_HOST}${path} timed out after 8000ms.`,
      });
    });

    req.end();
  });
}

function getRetryAfterMs(headers: IncomingHttpHeaders): number | undefined {
  const retryAfter = Array.isArray(headers["retry-after"])
    ? headers["retry-after"][0]
    : headers["retry-after"];

  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const retryAt = new Date(retryAfter).getTime();
  if (!Number.isNaN(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return undefined;
}

function parseLegacyResponse(payload: Record<string, unknown> | null): UsageData | null {
  if (!payload) {
    return null;
  }

  const session = extractWindow(payload["session"] ?? payload["sessionUsage"] ?? payload);
  const weekly = extractWindow(payload["weekly"] ?? payload["weeklyUsage"] ?? null);

  if (!session && !weekly) {
    return null;
  }

  return {
    session,
    weekly,
    fetchedAt: Date.now(),
    source: "api",
    state: "ready",
  };
}

function parseOauthUsageResponse(
  payload: Record<string, unknown> | null
): UsageData | null {
  if (!payload) {
    return null;
  }

  const session = extractOfficialWindow(
    payload["five_hour"] ?? payload["fiveHour"] ?? payload["session"] ?? null
  );
  const weekly = extractOfficialWindow(
    payload["seven_day"] ?? payload["sevenDay"] ?? payload["weekly"] ?? null
  );

  if (!session && !weekly) {
    return null;
  }

  return {
    session,
    weekly,
    fetchedAt: Date.now(),
    source: "oauth",
    state: "ready",
  };
}

function extractWindow(raw: unknown): RateLimitWindow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  const percent =
    typeof obj["percent"] === "number"
      ? obj["percent"]
      : typeof obj["percentUsed"] === "number"
      ? obj["percentUsed"]
      : typeof obj["used"] === "number" && typeof obj["limit"] === "number" && (obj["limit"] as number) > 0
      ? Math.round(((obj["used"] as number) / (obj["limit"] as number)) * 100)
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

function extractOfficialWindow(raw: unknown): RateLimitWindow | null {
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
