# Claude Usage

Real-time Claude Code rate limit tracker for the VS Code status bar. Shows session (5 h) and weekly (7 d) usage, countdowns, and quick actions.

## Install

Open VSX: search for `Claude Usage` or install the VSIX from releases.

## Features

- Status bar usage for session and weekly windows
- Countdown to next reset
- Quick actions: refresh, switch display mode, open settings, open output
- Diagnostics output for data source issues

## How it works

The extension collects usage from the following sources, in priority order:

1. Claude Code HTTP responses via `diagnostics_channel`
2. Local file fallback (`~/.claude/usage-bar-data.json` or `~/.claude/usage-data.json`)
3. OAuth usage endpoint (one-time bootstrap + background poll)

If no source is available, the status bar shows an error state and the output panel explains why.

## Commands

- `Claude Usage: Show Details`
- `Claude Usage: Refresh Rate Limit`
- `Claude Usage: Switch Display Mode (Session / Weekly / Both)`
- `Claude Usage: Open Output`

## Settings

- `claudeUsage.displayMode`: `session` | `weekly` | `both` | `auto`
- `claudeUsage.warningThreshold`: number (default 70)
- `claudeUsage.criticalThreshold`: number (default 90)
- `claudeUsage.refreshInterval`: seconds (default 30)
- `claudeUsage.showCountdown`: boolean (default true)
- `claudeUsage.notificationsEnabled`: boolean (default true)

## Local file fallback (optional)

If you want a fully local path with zero API calls, configure Claude Code to write a usage JSON file and the extension will pick it up.

## Privacy

The extension only reads local files and Claude Code responses. It does not send usage data to any third-party service. OAuth usage calls, when enabled, go directly to Anthropic’s API.

## Development

```
npm install
npm run build
npx vsce package --no-dependencies
```
