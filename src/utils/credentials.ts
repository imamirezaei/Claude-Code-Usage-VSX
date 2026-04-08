/**
 * Cross-platform credential retrieval using keytar.
 * Falls back to environment variable CLAUDE_API_TOKEN if keytar is unavailable.
 *
 * Supported platforms:
 *   - macOS: Keychain
 *   - Windows: Credential Manager
 *   - Linux: libsecret / Secret Service
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const KEYTAR_SERVICE = "Claude Code";
const KEYTAR_ACCOUNT = "api_key";
const CLAUDE_CODE_CREDENTIAL_SUFFIXES = ["", "-custom-oauth", "-local-oauth"];
const execFileAsync = promisify(execFile);

export interface ClaudeCodeOauthToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
}

export interface CredentialLookupResult<T> {
  value: T | null;
  issues: string[];
}

export async function getLegacyApiToken(): Promise<CredentialLookupResult<string>> {
  const issues: string[] = [];

  // Environment variable override (useful in CI or containers)
  if (process.env["CLAUDE_API_TOKEN"]) {
    return {
      value: process.env["CLAUDE_API_TOKEN"],
      issues,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require.resolve("keytar");
    // Dynamic require so the extension doesn't crash if keytar native binding fails
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const keytar = require("keytar") as typeof import("keytar");
    const token = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    if (token) {
      return {
        value: token,
        issues,
      };
    }
    issues.push(
      `Legacy API credential lookup did not find "${KEYTAR_SERVICE}/${KEYTAR_ACCOUNT}".`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Cannot find module")) {
      return {
        value: null,
        issues,
      };
    }
    issues.push(`Legacy API credential lookup unavailable in this runtime: ${message}`);
  }

  return {
    value: null,
    issues,
  };
}

export async function getClaudeCodeOauthToken(): Promise<
  CredentialLookupResult<ClaudeCodeOauthToken>
> {
  const issues: string[] = [];

  const macStore = await readClaudeCodeSecureStore();
  if (macStore) {
    const token = parseOauthToken(macStore);
    if (token) {
      return {
        value: token,
        issues,
      };
    }
    issues.push("Claude Code secure store was readable but did not contain claudeAiOauth.");
  } else if (process.platform === "darwin") {
    issues.push("Claude Code OAuth credentials were not found in macOS secure storage.");
  }

  const plaintext = readPlaintextCredentialStore();
  if (plaintext) {
    const token = parseOauthToken(plaintext);
    if (token) {
      return {
        value: token,
        issues,
      };
    }
    issues.push(
      "Claude Code plaintext credential file exists but does not contain claudeAiOauth."
    );
  } else {
    issues.push(
      `Claude Code plaintext credential file was not found at ${getPlaintextCredentialPath()}.`
    );
  }

  return {
    value: null,
    issues,
  };
}

function getClaudeConfigDir(): string {
  return process.env["CLAUDE_CONFIG_DIR"] ?? path.join(os.homedir(), ".claude");
}

function getPlaintextCredentialPath(): string {
  return path.join(getClaudeConfigDir(), ".credentials.json");
}

function readPlaintextCredentialStore(): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(getPlaintextCredentialPath(), "utf8");
    return safeParseObject(raw);
  } catch {
    return null;
  }
}

async function readClaudeCodeSecureStore(): Promise<Record<string, unknown> | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  for (const service of getClaudeCodeServiceCandidates()) {
    for (const account of getAccountCandidates()) {
      try {
        const { stdout } = await execFileAsync("security", [
          "find-generic-password",
          "-a",
          account,
          "-w",
          "-s",
          service,
        ]);
        const parsed = safeParseObject(stdout.trim());
        if (parsed) {
          return parsed;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

function getAccountCandidates(): string[] {
  const values = new Set<string>();

  const envUser = process.env["USER"];
  if (envUser) {
    values.add(envUser);
  }

  try {
    values.add(os.userInfo().username);
  } catch {
    // Ignore.
  }

  values.add("claude-code-user");
  return Array.from(values);
}

function getClaudeCodeServiceCandidates(): string[] {
  const values = new Set<string>();
  const hashSuffix = process.env["CLAUDE_CONFIG_DIR"]
    ? `-${crypto
        .createHash("sha256")
        .update(getClaudeConfigDir())
        .digest("hex")
        .slice(0, 8)}`
    : "";

  for (const oauthSuffix of CLAUDE_CODE_CREDENTIAL_SUFFIXES) {
    values.add(`Claude Code${oauthSuffix}-credentials${hashSuffix}`);
  }

  return Array.from(values);
}

function parseOauthToken(store: Record<string, unknown>): ClaudeCodeOauthToken | null {
  const oauth = store["claudeAiOauth"];
  if (!oauth || typeof oauth !== "object") {
    return null;
  }

  const obj = oauth as Record<string, unknown>;
  const accessToken = obj["accessToken"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return null;
  }

  const scopes = Array.isArray(obj["scopes"])
    ? obj["scopes"].filter((scope): scope is string => typeof scope === "string")
    : [];

  return {
    accessToken,
    refreshToken: typeof obj["refreshToken"] === "string" ? obj["refreshToken"] : null,
    expiresAt: typeof obj["expiresAt"] === "number" ? obj["expiresAt"] : null,
    scopes,
  };
}

function safeParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
