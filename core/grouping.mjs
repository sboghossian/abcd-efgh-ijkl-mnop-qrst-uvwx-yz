/**
 * Decision 20 (supersedes 12). A cwd inside a repository is an unambiguous,
 * free signal, so the root wins there. Everywhere else — and on a machine
 * where most sessions start from $HOME, that is most sessions — the group is
 * inferred from what the session is about: prompts, ticket refs, touched paths.
 */
import fs from "node:fs";
import { HOME, localConfig } from "./paths.mjs";

const DEFAULT_RULES = [
  ["Notes", /obsidian|vault|second brain|memory-layer|\d0-(sessions|projects|knowledge)/i],
  ["Agent tooling", /skill\.md|subagent|\bskills?\b|harness|agent[- ]?fleet/i],
  ["Infra", /deploy|docker|terraform|cloudflare|launchd|systemd/i],
  ["Docs", /readme|changelog|documentation|\bdocs?\b/i],
];

export function loadRules() {
  const cfg = localConfig();
  const raw = cfg.groupRules;
  if (Array.isArray(raw)) {
    try { return raw.map(([name, re]) => [name, new RegExp(re, "i")]); } catch { /* fall through */ }
  }
  try {
    const p = new URL("../scripts/group-rules.local.json", import.meta.url).pathname;
    return JSON.parse(fs.readFileSync(p, "utf8")).map(([name, re]) => [name, new RegExp(re, "i")]);
  } catch { return DEFAULT_RULES; }
}

const REPO_RE = /\/(?:Documents\/Code|Code|dev|repos|src|Projects)\/([^/]+)/;
const prettify = (n) => n.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 22);

export function groupFor(signal, cwd, rules = loadRules()) {
  const inRepo = cwd && cwd !== HOME && REPO_RE.test(cwd);
  if (inRepo) {
    for (const [name, re] of rules) if (re.test(cwd)) return name;
    const m = cwd.match(REPO_RE);
    if (m && m[1]) return prettify(m[1]);
  }
  for (const [name, re] of rules) if (re.test(signal || "")) return name;
  return "Ad hoc";
}

/** Public list prices applied to observed tokens. An estimate, never a bill. */
const PRICE = {
  opus:   { in: 15 / 1e6, out: 75 / 1e6, cr: 1.5 / 1e6, cw: 18.75 / 1e6 },
  sonnet: { in: 3 / 1e6,  out: 15 / 1e6, cr: 0.3 / 1e6, cw: 3.75 / 1e6 },
  haiku:  { in: 1 / 1e6,  out: 5 / 1e6,  cr: 0.1 / 1e6, cw: 1.25 / 1e6 },
};

export function estimateCost(model, t) {
  const m = /opus|fable/i.test(model || "") ? PRICE.opus
    : /haiku/i.test(model || "") ? PRICE.haiku
    : PRICE.sonnet;
  return +((t.input || 0) * m.in + (t.output || 0) * m.out
    + (t.cacheRead || 0) * m.cr + (t.cacheWrite || 0) * m.cw).toFixed(2);
}

/** Status is DERIVED from the session, never authored. */
export function deriveStatus(a, live, now = Date.now()) {
  if (live) {
    const idleMin = (now - new Date(a.lastAt || live.startedAt).getTime()) / 60000;
    if (a.pendingTool && idleMin < 6) return "working";
    if (idleMin < 3) return "working";
    if (idleMin < 90 && a.lastRole === "assistant") return "needs-input";
    return "idle";
  }
  if (a.sawFailed) return "failed";
  return "completed";
}
