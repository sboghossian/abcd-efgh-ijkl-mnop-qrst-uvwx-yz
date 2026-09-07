/**
 * Transcript reader. One JSON object per line, append-only.
 *
 * Never trusts a transcript to be small — one on the reference machine is
 * 16 MB — so every read is byte-capped and the session list is capped by
 * recency. Keeps parentUuid so a turn tree can be reconstructed later, which
 * is what makes replay and fork-from-any-point possible in Phase 2.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { PROJECTS, assertUnderHome } from "./paths.mjs";
import { readDir, clip, decodeProjectDir } from "./fsutil.mjs";

export const DEFAULTS = { maxSessions: 48, maxBytes: 20 * 1024 * 1024, maxTurns: 14 };

function newAcc(id) {
  return {
    id, title: null, aiTitle: null, prompts: [], firstPrompt: null,
    cwd: null, gitBranch: null, model: null, version: null,
    firstAt: null, lastAt: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    turns: [], files: [], prLinks: [], tickets: new Set(),
    sawFailed: false, sawResult: false, lastRole: null, pendingTool: false,
  };
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

  const content = Array.isArray(m.content) ? m.content
    : typeof m.content === "string" ? [{ type: "text", text: m.content }] : [];
  let text = ""; const tools = [];
  let sawUse = false, sawResult = false;
  for (const c of content) {
    if (c.type === "text" && c.text) text += c.text;
    if (c.type === "tool_result") sawResult = true;
    if (c.type === "tool_use") {
      sawUse = true;
      const inp = c.input || {};
      const summary = inp.file_path || inp.path || inp.command || inp.pattern
        || inp.query || inp.url || inp.description || inp.skill || inp.subagent_type || "";
      tools.push({ name: c.name || "tool", summary: clip(summary, 84) });
      const fp = inp.file_path || inp.path;
      if (fp && ["Write", "Edit", "NotebookEdit"].includes(c.name)) {
        a.files.push({ path: String(fp), kind: String(fp).includes("/memory/") ? "memory" : "file", at: j.timestamp });
      }
    }
  }
  if (sawUse) a.pendingTool = true;
  if (sawResult) a.pendingTool = false;

  for (const t of String(text).match(/\b[A-Z]{2,4}-\d{2,5}\b/g) || []) a.tickets.add(t);
  if (j.type === "user" && text.trim() && !text.trim().startsWith("<") && a.prompts.length < 5) {
    a.prompts.push(clip(text, 150));
    if (!a.firstPrompt) a.firstPrompt = a.prompts[0];
  }
  if (j.type === "user" || j.type === "assistant") a.lastRole = j.type;

  if (text.trim() || tools.length) {
    a.turns.push({
      uuid: j.uuid ?? `${a.turns.length}`,
      parent: j.parentUuid ?? null,
      role: j.type === "user" ? "user" : "assistant",
      at: j.timestamp, text: clip(text, 820), tools: tools.slice(0, 5),
    });
    if (a.turns.length > 90) a.turns.splice(0, a.turns.length - 90);
  }
}

export async function readTranscript(file, id, maxBytes = DEFAULTS.maxBytes) {
  assertUnderHome(file);
  const a = newAcc(id);
  let bytes = 0;
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      bytes += line.length;
      if (bytes > maxBytes) { a.truncated = true; break; }
      if (line.length > 300_000) continue;
      ingest(a, line);
    }
  } catch { /* keep whatever parsed */ }
  finally { rl.close(); stream.destroy(); }
  return a;
}

/** Every transcript on disk, newest first. Cheap: stat only, no parsing. */
export async function listTranscripts() {
  const files = [];
  for (const d of await readDir(PROJECTS)) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS, d.name);
    for (const f of await readDir(dir)) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const full = path.join(dir, f.name);
      try {
        const st = await fs.stat(full);
        files.push({ full, mtime: st.mtimeMs, size: st.size, projectCwd: decodeProjectDir(d.name), id: f.name.replace(/\.jsonl$/, "") });
      } catch { /* skip */ }
    }
  }
  files.sort((x, y) => y.mtime - x.mtime);
  return files;
}

export async function readRecent(limit = DEFAULTS.maxSessions, maxBytes = DEFAULTS.maxBytes) {
  const files = await listTranscripts();
  const accs = [];
  for (const f of files.slice(0, limit)) {
    const a = await readTranscript(f.full, f.id, maxBytes);
    a.projectCwd = f.projectCwd; a.mtime = f.mtime; a.size = f.size;
    accs.push(a);
  }
  return { accs, allFiles: files };
}

/**
 * First prompts are messy: skill instruction blocks, hook output and pasted
 * material all arrive as "user" messages. Pick the first one that is actually
 * the person talking.
 */
const NOISE = /^(approach this as|you are (a|the)\b|base directory for this skill|this session is|caveat:|<|\[|#{1,3}\s|---|system-reminder|the user (opened|sent))/i;

export function titleFor(a) {
  if (a.title) return a.title;
  if (a.aiTitle) return a.aiTitle;
  const candidates = (a.prompts?.length ? a.prompts : [a.firstPrompt]).filter(Boolean);
  let t = candidates.find((c) => !NOISE.test(String(c).trim())) || "";
  t = String(t).trim()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^["'`\s>*\-]+/, "")
    .replace(/^(please|can you|could you|i want to|i need to|lets|let's|now|so|ok|okay|and|also)\b[,:\s]*/i, "");
  const stop = t.search(/[.?!\n]|\s—\s/);
  if (stop > 14) t = t.slice(0, stop);
  t = t.replace(/\s+/g, " ").trim();
  if (t.length < 4) {
    if (a.gitBranch && !["main", "master", "HEAD"].includes(a.gitBranch)) return a.gitBranch;
    return "Untitled session";
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
