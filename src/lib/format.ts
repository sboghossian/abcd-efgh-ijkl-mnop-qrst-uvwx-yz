/** Display helpers. Every number the UI shows passes through here. */

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/**
 * Always rendered next to the word "est." — decision 17. On a
 * subscription there is no per-token bill, so this is derived, not billed.
 */
export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function totalTokens(t: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/^gpt-5-/, "");
}

export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export const STATUS_LABEL: Record<string, string> = {
  working: "Working",
  "needs-input": "Needs input",
  idle: "Idle",
  completed: "Completed",
  failed: "Failed",
};
