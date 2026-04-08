/**
 * Human-readable countdown formatting utilities.
 */

/** Format milliseconds remaining into "Xd Yh", "Xh Ym", "Xm", or "now" */
export function formatCountdown(resetAt: number): string {
  const remaining = resetAt - Date.now();

  if (remaining <= 0) {
    return "now";
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "<1m";
}

/** Format a reset timestamp as an absolute time string, e.g. "3:45 PM" */
export function formatResetTime(resetAt: number): string {
  return new Date(resetAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format a reset timestamp as a full date+time string */
export function formatResetDateTime(resetAt: number): string {
  return new Date(resetAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
