#!/usr/bin/env node
/**
 * snapshot-live — read the operator's ACTUAL Claude Code setup and emit
 * `src/fixtures/live.local.ts`, so the mock can be clicked through with
 * real sessions, groups, vault notes and system state.
 *
 * The output is GITIGNORED and must never be committed: it contains real
 * transcripts. `demo.ts` stays the synthetic source the public repo ships.
 *
 * Bounded by construction. Never bulk-scans the vault (iCloud eviction
 * hangs) and never trusts a transcript to be small (one was 16 MB):
 * every read is byte-capped and the session list is capped by recency.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const HOME = os.homedir();
const CLAUDE = path.join(HOME, ".claude");
const PROJECTS = path.join(CLAUDE, "projects");
// Vault location, in priority order: ABCD_VAULT, a gitignored
// `scripts/paths.local.json` ({"vault": "..."}), then generic candidates.
// Never a bulk scan — walking an iCloud tree hangs on evicted files.
let localPaths = {};
try {
  const { readFileSync } = await import("node:fs");
  localPaths = JSON.parse(readFileSync(new URL("./paths.local.json", import.meta.url), "utf8"));
} catch { /* no local overrides */ }

const VAULT_CANDIDATES = [
  process.env.ABCD_VAULT,
  localPaths.vault,
  path.join(HOME, "Documents/Obsidian"),
  path.join(HOME, "Obsidian"),
  path.join(HOME, "vault"),
].filter(Boolean);

let VAULT = VAULT_CANDIDATES[0] || path.join(HOME, "vault");
for (const c of VAULT_CANDIDATES) {
  try {
    const { statSync } = await import("node:fs");
    if (statSync(c).isDirectory()) { VAULT = c; break; }
  } catch { /* next candidate */ }
}

const OUT = path.join(process.cwd(), "src/fixtures/live.local.ts");

const MAX_SESSIONS = 44;
const MAX_BYTES_PER_FILE = 20 * 1024 * 1024;
const MAX_TURNS = 12;
const MAX_NOTES = 300;

const log = (...a) => console.log("  ", ...a);

async function safeReadJson(p) { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; } }
async function safeReadDir(p) { try { return await fs.readdir(p, { withFileTypes: true }); } catch { return []; } }
async function safeReadText(p, cap = 8000) {
  let h = null;
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return "";
    h = await fs.open(p, "r");
    const b = Buffer.alloc(cap);
    const { bytesRead } = await h.read(b, 0, cap, 0);
    return b.subarray(0, bytesRead).toString("utf8");
  } catch { return ""; }
  finally { if (h) await h.close().catch(() => {}); }
}
const decodeProjectDir = (n) => n.replace(/^-/, "/").replace(/-/g, "/");
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/* ---------------- live process registry (tier 2) ---------------- */
async function readLiveRegistry() {
  const out = new Map();
  for (const e of await safeReadDir(path.join(CLAUDE, "sessions"))) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const j = await safeReadJson(path.join(CLAUDE, "sessions", e.name));
    if (!j?.sessionId) continue;
    let alive = false;
    try { process.kill(j.pid, 0); alive = true; } catch { alive = false; }
    if (!alive) continue;
    out.set(j.sessionId, {
      pid: j.pid, cwd: j.cwd, startedAt: j.startedAt,
      entrypoint: j.entrypoint || "terminal",
      hasSocket: Boolean(j.messagingSocketPath), name: j.name || null,
    });
  }
  return out;
}

/* ---------------- transcripts ---------------- */
function newAcc(id) {
  return { id, title: null, aiTitle: null, firstPrompt: null, prompts: [], cwd: null, gitBranch: null,
    model: null, version: null, firstAt: null, lastAt: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    turns: [], outputs: [], prLinks: [], tickets: new Set(),
    sawFailed: false, sawResult: false, lastRole: null, pendingTool: false };
}

function ingest(a, line) {
  let j; try { j = JSON.parse(line); } catch { return; }
  if (j.timestamp) { if (!a.firstAt) a.firstAt = j.timestamp; a.lastAt = j.timestamp; }
  if (j.cwd && !a.cwd) a.cwd = j.cwd;
  if (j.gitBranch && !a.gitBranch) a.gitBranch = j.gitBranch;
  if (j.version) a.version = j.version;
  if (j.type === "custom-title" && j.title) a.title = j.title;
  if (j.type === "ai-title" && (j.title || j.text)) a.aiTitle = j.title || j.text;
  if (j.type === "pr-link" && (j.url || j.prUrl)) a.prLinks.push(j.url || j.prUrl);
  if (j.type === "failed") a.sawFailed = true;
  if (j.type === "result") a.sawResult = true;

  const m = j.message; if (!m) return;
  if (m.model) a.model = m.model;
  const u = m.usage;
  if (u) {
    a.tokens.input += u.input_tokens || 0;
    a.tokens.output += u.output_tokens || 0;
    a.tokens.cacheRead += u.cache_read_input_tokens || 0;
    a.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
  }

  let text = "";
  const tools = [];
  const content = Array.isArray(m.content) ? m.content : (typeof m.content === "string" ? [{ type: "text", text: m.content }] : []);
  let sawToolUse = false, sawToolResult = false;
  for (const c of content) {
    if (c.type === "text" && c.text) text += c.text;
    if (c.type === "tool_result") sawToolResult = true;
    if (c.type === "tool_use") {
      sawToolUse = true;
      const inp = c.input || {};
      const summary = inp.file_path || inp.path || inp.command || inp.pattern || inp.query ||
        inp.url || inp.description || inp.skill || inp.subagent_type || "";
      tools.push({ name: c.name || "tool", summary: clip(summary, 84) });
      const fp = inp.file_path || inp.path;
      if (fp && ["Write", "Edit", "NotebookEdit"].includes(c.name)) {
        const sp = String(fp);
        a.outputs.push({ kind: sp.includes("/memory/") ? "memory" : "file", label: path.basename(sp), p: sp, at: j.timestamp });
      }
    }
  }
  if (sawToolUse) a.pendingTool = true;
  if (sawToolResult) a.pendingTool = false;

  for (const t of String(text).match(/\b[A-Z]{2,4}-\d{2,5}\b/g) || []) a.tickets.add(t);

  if (j.type === "user" && text.trim() && !text.trim().startsWith("<") && a.prompts.length < 5) {
    a.prompts.push(clip(text, 150));
    if (!a.firstPrompt) a.firstPrompt = a.prompts[0];
  }
  if (j.type === "user" || j.type === "assistant") a.lastRole = j.type;
  if (text.trim() || tools.length) {
    a.turns.push({ role: j.type === "user" ? "user" : "assistant", at: j.timestamp, text: clip(text, 820), tools: tools.slice(0, 5) });
    if (a.turns.length > 90) a.turns.splice(0, a.turns.length - 90);
  }
}

async function readTranscript(file, id) {
  const a = newAcc(id);
  let bytes = 0;
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      bytes += line.length;
      if (bytes > MAX_BYTES_PER_FILE) break;
      if (line.length > 300_000) continue;
      ingest(a, line);
    }
  } catch { /* keep what we have */ }
  finally { rl.close(); stream.destroy(); }
  return a;
}

async function collectSessions() {
  const files = [];
  for (const d of await safeReadDir(PROJECTS)) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS, d.name);
    for (const f of await safeReadDir(dir)) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const full = path.join(dir, f.name);
      try { const st = await fs.stat(full);
        files.push({ full, mtime: st.mtimeMs, projectCwd: decodeProjectDir(d.name), id: f.name.replace(/\.jsonl$/, "") });
      } catch { /* skip */ }
    }
  }
  files.sort((x, y) => y.mtime - x.mtime);
  log(`transcripts: ${files.length} found, reading ${Math.min(MAX_SESSIONS, files.length)} most recent`);
  const accs = [];
  for (const f of files.slice(0, MAX_SESSIONS)) {
    const a = await readTranscript(f.full, f.id);
    a.projectCwd = f.projectCwd; a.mtime = f.mtime;
    accs.push(a);
  }
  return { accs, allFiles: files };
}

export { HOME, CLAUDE, PROJECTS, VAULT, OUT, MAX_NOTES, MAX_TURNS, log, clip,
  safeReadDir, safeReadJson, safeReadText, collectSessions, readLiveRegistry, path, fs };
