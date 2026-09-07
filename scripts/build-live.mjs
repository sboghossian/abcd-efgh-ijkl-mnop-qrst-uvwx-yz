#!/usr/bin/env node
/**
 * Emit src/fixtures/live.local.ts from the operator's real setup.
 * GITIGNORED output. Run: npm run snapshot
 */
import {
  HOME, CLAUDE, VAULT, OUT, MAX_NOTES, MAX_TURNS, log, clip,
  safeReadDir, safeReadJson, safeReadText, collectSessions, readLiveRegistry, path, fs,
} from "./snapshot-live.mjs";

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

/* ---------------- group inference ---------------- */
// A group binds to a primary filesystem root (decision 12) but a real theme
// spans repositories, so extra roots are collected too.
// Grouping cannot rely on cwd alone: on this machine almost every session
// runs from $HOME, so cwd carries no signal. Score the prompt, the ticket
// refs and the paths the session actually touched instead.
// Default rules are generic. Personal ones (employer, teammates, private repo
// names) belong in `scripts/group-rules.local.json`, which is gitignored:
//   [["Work", "acme|TICKET-\\d"], ["Notes", "obsidian|vault"]]
const DEFAULT_GROUP_RULES = [
  ["Notes", /obsidian|vault|second brain|memory-layer|\d0-(sessions|projects|knowledge)/i],
  ["Agent tooling", /skill\.md|subagent|\bskills?\b|harness|agent[- ]?fleet/i],
  ["Infra", /deploy|docker|terraform|cloudflare|launchd|systemd/i],
  ["Docs", /readme|changelog|documentation|\bdocs?\b/i],
];

let GROUP_RULES = DEFAULT_GROUP_RULES;
try {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL("./group-rules.local.json", import.meta.url), "utf8");
  GROUP_RULES = JSON.parse(raw).map(([name, re]) => [name, new RegExp(re, "i")]);
} catch { /* no local overrides: generic rules it is */ }

/**
 * Decision 12, revised. A cwd inside a repository is an unambiguous, free
 * signal, so the root wins there. But on this machine most sessions run from
 * $HOME, where cwd says nothing — so everywhere else, infer from what the
 * session is actually about: its prompts, ticket refs and touched paths.
 */
const REPO_RE = /\/(?:Documents\/Code|Code|dev|repos|src|Projects)\/([^/]+)/;

function prettify(name) {
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 22);
}

function groupFor(signal, cwd) {
  const inRepo = cwd && cwd !== HOME && REPO_RE.test(cwd);
  if (inRepo) {
    for (const [name, re] of GROUP_RULES) if (re.test(cwd)) return name;
    const m = cwd.match(REPO_RE);
    if (m && m[1]) return prettify(m[1]);
  }
  for (const [name, re] of GROUP_RULES) if (re.test(signal || "")) return name;
  return "Ad hoc";
}

function titleFrom(a) {
  if (a.title) return a.title;
  if (a.aiTitle) return a.aiTitle;

  // Skill instruction blocks, hook output and tool preambles all arrive as
  // "user" messages. None of them is what the session is about.
  const NOISE = /^(approach this as|you are (a|the)\b|base directory for this skill|this session is|caveat:|<|\[|#{1,3}\s|---|system-reminder|the user (opened|sent)|running the preamble)/i;
  const candidates = (a.prompts && a.prompts.length ? a.prompts : [a.firstPrompt]).filter(Boolean);
  let t = candidates.find((c) => !NOISE.test(String(c).trim())) || "";

  t = String(t).trim()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^["'`\s>*\-]+/, "")
    .replace(/^(please|can you|could you|i want to|i need to|lets|let's|now|so|ok|okay|and|also)\b[,:\s]*/i, "");
  const stop = t.search(/[.?!\n]|\s—\s/);
  if (stop > 14) t = t.slice(0, stop);
  t = t.replace(/\s+/g, " ").trim();

  if (t.length < 4) {
    // "HEAD" is a detached checkout, not a name a person would recognise.
    if (a.gitBranch && !["main", "master", "HEAD"].includes(a.gitBranch)) return a.gitBranch;
    const base = (a.cwd || a.projectCwd || "").split("/").filter(Boolean).pop();
    return base && base !== path.basename(HOME) ? `Session in ${base}` : "Untitled session";
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}



/* ---------------- status inference ---------------- */
function statusFor(a, live) {
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

/* ---------------- cost estimate ---------------- */
// Public list prices applied to observed tokens. Never a bill. Decision 17.
const PRICE = {
  opus:   { in: 15 / 1e6, out: 75 / 1e6, cr: 1.5 / 1e6, cw: 18.75 / 1e6 },
  sonnet: { in: 3 / 1e6,  out: 15 / 1e6, cr: 0.3 / 1e6, cw: 3.75 / 1e6 },
  haiku:  { in: 1 / 1e6,  out: 5 / 1e6,  cr: 0.1 / 1e6, cw: 1.25 / 1e6 },
};
function estimate(model, t) {
  const m = /opus|fable/i.test(model || "") ? PRICE.opus : /haiku/i.test(model || "") ? PRICE.haiku : PRICE.sonnet;
  return +(t.input * m.in + t.output * m.out + t.cacheRead * m.cr + t.cacheWrite * m.cw).toFixed(2);
}

/* ---------------- vault ---------------- */
async function collectNotes() {
  const folders = ["20-Projects", "30-Knowledge", "10-Sessions", "50-Wiki", "40-Resources"];
  const notes = [];
  for (const folder of folders) {
    const dir = path.join(VAULT, folder);
    const entries = await safeReadDir(dir);
    if (!entries.length) continue;
    // Bounded: never stat the whole folder. 30-Knowledge alone has 20,742 files.
    const per = Math.max(24, Math.floor(MAX_NOTES / folders.length));
    const picked = [];
    for (const e of entries) {
      if (picked.length >= per) break;
      if (e.isFile() && e.name.endsWith(".md")) picked.push(path.join(dir, e.name));
      else if (e.isDirectory()) {
        const idx = path.join(dir, e.name, "_index.md");
        try { await fs.access(idx); picked.push(idx); } catch { /* no index */ }
      }
    }
    for (const p of picked) {
      const raw = await safeReadText(p, 4000);
      if (!raw) continue;
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      const block = fm ? fm[1] : "";
      const title = (block.match(/^title:\s*"?([^"\n]+)"?/m)?.[1] || path.basename(p, ".md")).trim();
      const tags = [...block.matchAll(/^\s*-\s*([\w/-]+)$/gm)].map((x) => x[1]).slice(0, 4);
      const links = [...raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1].trim()).slice(0, 6);
      const body = raw.replace(/^---[\s\S]*?---/, "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
      let updatedAt = iso(now - 86_400_000);
      try { updatedAt = iso((await fs.stat(p)).mtimeMs); } catch { /* keep default */ }
      notes.push({ path: path.relative(VAULT, p), title: clip(title, 64), folder, tags, links, updatedAt, excerpt: clip(body, 190) });
    }
  }
  log(`vault notes sampled: ${notes.length}`);
  return notes.slice(0, MAX_NOTES);
}

/* ---------------- heatmap: index + vault enrichment (decision 08) ---------------- */
async function collectUsage(allFiles) {
  const byDay = new Map();
  const add = (date, sessions, tokens) => {
    const cur = byDay.get(date) || { sessions: 0, tokens: 0 };
    cur.sessions += sessions; cur.tokens += tokens;
    byDay.set(date, cur);
  };
  for (const f of allFiles) add(iso(f.mtime).slice(0, 10), 1, 0);
  const retained = new Set(byDay.keys());
  let enriched = 0;
  for (const e of await safeReadDir(path.join(VAULT, "10-Sessions"))) {
    const m = e.name.match(/(20\d{2}-\d{2}-\d{2})/);
    if (!m || retained.has(m[1])) continue;
    add(m[1], 1, 0); enriched++;
  }
  for (const sub of ["claude-code", "sessions"]) {
    for (const e of await safeReadDir(path.join(VAULT, "10-Sessions", sub))) {
      const m = e.name.match(/(20\d{2}-\d{2}-\d{2})/);
      if (!m || retained.has(m[1])) continue;
      add(m[1], 1, 0); enriched++;
    }
  }
  log(`usage days: ${byDay.size} (${retained.size} retained by Claude Code, ${enriched} recovered from vault)`);
  const out = [];
  for (let i = 181; i >= 0; i--) {
    const d = iso(now - i * 86_400_000).slice(0, 10);
    const v = byDay.get(d) || { sessions: 0, tokens: 0 };
    out.push({ date: d, sessions: v.sessions, tokens: v.tokens, costEstimateUsd: 0 });
  }
  return { usage: out, retainedDays: retained.size, enrichedDays: enriched };
}

export { groupFor, titleFrom, statusFor, estimate, collectNotes, collectUsage, iso, now };
