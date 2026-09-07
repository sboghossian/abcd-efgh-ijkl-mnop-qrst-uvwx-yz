/**
 * Codex adapter — decision 22, full parity wherever technically possible.
 *
 * Codex publishes no live session registry, so there is nothing to read
 * liveness from. That is precisely why the RuntimeAdapter contract requires
 * parseTranscript and deriveStatus rather than treating them as Claude-only
 * helpers: for this runtime they are the ONLY way to know anything.
 *
 * Format learned from real transcripts on disk, not from documentation:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
 *   ~/.codex/session_index.jsonl   {id, thread_name, updated_at}
 *
 * Each line is {timestamp, type, payload}:
 *   session_meta                    id, cwd, originator, cli_version, source
 *   event_msg / user_message        the person
 *   event_msg / agent_message       the model
 *   event_msg / token_count         info.total_token_usage {...}
 *   event_msg / task_started|task_complete
 *   response_item / message         role + content[{type:input_text|output_text, text}]
 *   response_item / function_call   tool use
 */
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import os from "node:os";

import { registerRuntime, EVENT } from "./adapter.mjs";
import { clip } from "../fsutil.mjs";
import { titleFor } from "../transcript.mjs";

const CODEX_HOME = path.join(os.homedir(), ".codex");
const SESSIONS = path.join(CODEX_HOME, "sessions");
const INDEX = path.join(CODEX_HOME, "session_index.jsonl");

/**
 * Capabilities are DISCOVERED, not asserted: the UI renders from this, so a
 * runtime that cannot do something shows it as unavailable instead of broken.
 * PATH is walked directly rather than shelling out, which avoids handing an
 * unescaped string to a shell.
 */
function detect() {
  let binary = null;
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "codex");
    try { if (existsSync(candidate)) { binary = candidate; break; } } catch { /* next */ }
  }
  return { binary, installed: Boolean(binary), history: existsSync(SESSIONS) };
}

const env = detect();

export const codexAdapter = registerRuntime({
  id: "codex",
  label: "Codex",
  capabilities: {
    // Spawning needs the binary; history only needs the transcripts.
    spawn: env.installed,
    streamInput: env.installed,
    interrupt: env.installed,
    resume: false,
    fork: false,
    /** No live registry exists, so foreign sessions can never be discovered. */
    registry: false,
    gates: false,
    /** token_count is emitted, but no cost figure. Cost stays estimated. */
    reportedCost: false,
    /** Skills, hooks and memory are Claude Code concepts; they do not apply. */
    harness: false,
  },
  env,

  buildSpawn({ cwd, prompt, model }) {
    if (!env.installed) throw new Error("codex is not installed on this machine");
    const args = ["exec", "--json"];
    if (model) args.push("--model", model);
    if (prompt) args.push(prompt);
    return { cmd: env.binary || "codex", args, cwd, env: { ...process.env, ABCD_RUN: "1" } };
  },

  parseEvent(line) {
    let j; try { j = JSON.parse(line); } catch { return null; }
    const p = j.payload ?? {};
    const t = j.type;

    if (t === "session_meta") {
      return { kind: EVENT.INIT, sessionId: p.id, cwd: p.cwd, model: p.model_provider ?? null,
        version: p.cli_version ?? null, raw: { originator: p.originator, source: p.source } };
    }
    if (t === "event_msg") {
      switch (p.type) {
        case "agent_message": return { kind: EVENT.TEXT, text: p.message ?? "" };
        case "user_message": return { kind: EVENT.TEXT, role: "user", text: p.message ?? "" };
        case "task_started": return { kind: EVENT.STATUS, phase: "start" };
        case "task_complete": return { kind: EVENT.RESULT, ok: true, reportedCostUsd: null, usage: null };
        case "token_count": return { kind: EVENT.STATUS, usage: p.info?.total_token_usage ?? null };
        default: return null;
      }
    }
    if (t === "response_item") {
      if (p.type === "function_call") {
        return { kind: EVENT.TOOL_USE, id: p.call_id ?? null, name: p.name ?? "tool", summary: clip(p.arguments ?? "", 84) };
      }
      if (p.type === "function_call_output") return { kind: EVENT.TOOL_RESULT, toolUseId: p.call_id ?? null, ok: true };
    }
    return null;
  },

  encodeInput(text) { return `${text}\n`; },

  /**
   * Without a registry there is no liveness signal, so status is derived
   * entirely from the transcript. abcd says "completed", never "working",
   * because it genuinely cannot tell — and guessing would be a lie.
   */
  deriveStatus(acc) {
    if (acc.sawFailed) return "failed";
    if (!acc.sawResult && acc.lastRole === "assistant") return "completed";
    return "completed";
  },

  async parseTranscript(file, id) {
    const a = {
      id, title: null, aiTitle: null, prompts: [], firstPrompt: null,
      cwd: null, gitBranch: null, model: null, version: null,
      firstAt: null, lastAt: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      turns: [], files: [], prLinks: [], tickets: new Set(),
      sawFailed: false, sawResult: false, lastRole: null, pendingTool: false,
    };
    const stream = createReadStream(file, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        const p = j.payload ?? {};
        if (j.timestamp) { if (!a.firstAt) a.firstAt = j.timestamp; a.lastAt = j.timestamp; }

        if (j.type === "session_meta") {
          a.cwd = p.cwd ?? a.cwd;
          a.model = p.model_provider ?? a.model;
          a.version = p.cli_version ?? a.version;
          continue;
        }
        if (j.type === "event_msg") {
          if (p.type === "token_count") {
            const u = p.info?.total_token_usage ?? {};
            a.tokens.input = u.input_tokens ?? a.tokens.input;
            a.tokens.output = u.output_tokens ?? a.tokens.output;
            a.tokens.cacheRead = u.cached_input_tokens ?? a.tokens.cacheRead;
          }
          if (p.type === "task_complete") a.sawResult = true;
          if (p.type === "user_message" && p.message) {
            if (a.prompts.length < 5) a.prompts.push(clip(p.message, 150));
            if (!a.firstPrompt) a.firstPrompt = a.prompts[0];
            a.lastRole = "user";
            a.turns.push({ uuid: `${a.turns.length}`, parent: null, role: "user", at: j.timestamp, text: clip(p.message, 820), tools: [] });
          }
          if (p.type === "agent_message" && p.message) {
            a.lastRole = "assistant";
            a.turns.push({ uuid: `${a.turns.length}`, parent: null, role: "assistant", at: j.timestamp, text: clip(p.message, 820), tools: [] });
          }
          continue;
        }
        if (j.type === "response_item" && p.type === "message") {
          const text = (p.content ?? []).map((c) => c.text ?? "").join("").trim();
          if (!text) continue;
          const role = p.role === "user" ? "user" : "assistant";
          a.lastRole = role;
          if (role === "user") {
            if (a.prompts.length < 5) a.prompts.push(clip(text, 150));
            if (!a.firstPrompt) a.firstPrompt = a.prompts[0];
          }
          a.turns.push({ uuid: `${a.turns.length}`, parent: null, role, at: j.timestamp, text: clip(text, 820), tools: [] });
        }
        if (a.turns.length > 90) a.turns.splice(0, a.turns.length - 90);
      }
    } catch { /* keep what parsed */ }
    finally { rl.close(); stream.destroy(); }
    return a;
  },
});

/** Codex transcripts, newest first. Empty when Codex was never used here. */
export async function listCodexTranscripts() {
  const out = [];
  const walk = async (dir, depth = 0) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full, depth + 1); continue; }
      if (!e.name.endsWith(".jsonl")) continue;
      try {
        const st = await fs.stat(full);
        const m = e.name.match(/([0-9a-f-]{36})\.jsonl$/i);
        out.push({ full, mtime: st.mtimeMs, id: m?.[1] ?? e.name.replace(/\.jsonl$/, ""), runtimeId: "codex" });
      } catch { /* skip */ }
    }
  };
  await walk(SESSIONS);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** Thread names live in a separate index file, keyed by session id. */
export async function codexTitles() {
  const map = new Map();
  try {
    const raw = await fs.readFile(INDEX, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j.id) map.set(j.id, j.thread_name ?? null); } catch { /* skip */ }
    }
  } catch { /* no index */ }
  return map;
}

export const codexEnv = env;

/**
 * Codex injects AGENTS.md as the first user message, so the opening prompt is
 * usually instructions rather than intent. The index's thread_name is the
 * human-meaningful title when present; otherwise fall back to the shared
 * noise-filtering title logic.
 */
const CODEX_NOISE = /^(#\s|the following is the codex agent history|agents\.md|<inst)/i;

export function codexTitle(acc, indexTitles) {
  const named = indexTitles?.get(acc.id);
  if (named && String(named).trim()) return String(named).trim();
  // Drop Codex's own preambles before falling back to the shared title logic.
  const clean = { ...acc, prompts: (acc.prompts ?? []).filter((p) => !CODEX_NOISE.test(String(p).trim())) };
  clean.firstPrompt = clean.prompts[0] ?? null;
  const t = titleFor(clean);
  return t === "Untitled session" && acc.cwd ? `Codex in ${acc.cwd.split("/").pop()}` : t;
}
