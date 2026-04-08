/**
 * Watches ~/.claude/usage-bar-data.json written by the Claude Code CLI.
 * Used as a reliable cross-platform fallback when the HTTP channel is unavailable.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { UsageData, RateLimitWindow } from "../models/usageData";
import { logInfo, logWarn } from "./outputChannel";

type UpdateCallback = (data: UsageData) => void;

const USAGE_FILES = [
  path.join(os.homedir(), ".claude", "usage-bar-data.json"),
  path.join(os.homedir(), ".claude", "usage-data.json"),
];

export class FileWatcherProvider {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onUpdate: UpdateCallback) {}

  start(): void {
    // Read immediately on start
    this.readFile();

    // Watch the directory (more reliable than watching a file that may not exist yet)
    const dir = path.dirname(USAGE_FILES[0]);
    if (!fs.existsSync(dir)) {
      logWarn(`Claude config directory does not exist: ${dir}`);
      return;
    }

    if (!USAGE_FILES.some((file) => fs.existsSync(file))) {
      logWarn(
        `File fallback source unavailable. None of these files exist: ${USAGE_FILES.join(
          ", "
        )}`
      );
      logInfo(
        'Claude Code can provide zero-API rate limits via statusLine scripts. If you want a local-file fallback, configure Claude Code to write "~/.claude/usage-bar-data.json".'
      );
    } else {
      logInfo(`Watching Claude usage files in ${dir}`);
    }

    try {
      this.watcher = fs.watch(dir, (eventType, filename) => {
        if (USAGE_FILES.some((file) => filename === path.basename(file))) {
          this.scheduleRead();
        }
      });
    } catch {
      // Directory watch failed — silent, we already did one read
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleRead(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.readFile(), 300);
  }

  private readFile(): void {
    const usageFile = USAGE_FILES.find((file) => fs.existsSync(file));
    if (!usageFile) {
      return;
    }

    try {
      const raw = fs.readFileSync(usageFile, "utf8");
      const parsed = JSON.parse(raw);
      const data = this.parseFileData(parsed);
      if (data) {
        this.onUpdate(data);
      }
    } catch {
      // Malformed or partially written — ignore
    }
  }

  private parseFileData(raw: Record<string, unknown>): UsageData | null {
    const rateLimits =
      raw["rate_limits"] && typeof raw["rate_limits"] === "object"
        ? (raw["rate_limits"] as Record<string, unknown>)
        : null;

    const session = this.extractWindow(
      raw["session"] ?? rateLimits?.["five_hour"] ?? raw
    );
    const weekly = this.extractWindow(
      raw["weekly"] ?? rateLimits?.["seven_day"] ?? null
    );

    if (!session && !weekly) {
      return null;
    }

    return {
      session,
      weekly,
      fetchedAt: Date.now(),
      source: "file",
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
        : typeof obj["used_percentage"] === "number"
        ? obj["used_percentage"]
        : typeof obj["utilization"] === "number"
        ? obj["utilization"] <= 1
          ? Math.round(obj["utilization"] * 100)
          : Math.round(obj["utilization"])
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
        : typeof obj["resets_at"] === "string"
        ? new Date(obj["resets_at"] as string).getTime()
        : typeof obj["resets_at"] === "number"
        ? obj["resets_at"]
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
