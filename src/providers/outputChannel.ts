import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

function getTimestamp(): string {
  return new Date().toISOString();
}

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Claude Usage");
  }
  return channel;
}

export function logInfo(message: string): void {
  getOutputChannel().appendLine(`[${getTimestamp()}] INFO  ${message}`);
}

export function logWarn(message: string): void {
  getOutputChannel().appendLine(`[${getTimestamp()}] WARN  ${message}`);
}

export function logError(message: string): void {
  getOutputChannel().appendLine(`[${getTimestamp()}] ERROR ${message}`);
}

export function revealOutputChannel(): void {
  getOutputChannel().show(true);
}
