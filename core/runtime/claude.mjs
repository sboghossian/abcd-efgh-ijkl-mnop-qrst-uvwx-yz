/**
 * Claude Code adapter.
 *
 * Learned from a real run rather than from --help, because the help text omits
 * two things that make the difference between working and not:
 *   - --output-format=stream-json REQUIRES --verbose under --print
 *   - stdin must be handled explicitly or the CLI waits 3s and warns
 *
 * The result event carries `total_cost_usd`, so for sessions abcd runs itself
 * cost is measured and reported by the runtime, not estimated from a price
 * table. Historical transcripts stay estimated; owned sessions do not have to.
 */
import { registerRuntime, EVENT } from "./adapter.mjs";
import { readTranscript } from "../transcript.mjs";
import { deriveStatus } from "../grouping.mjs";

export const claudeAdapter = registerRuntime({
  id: "claude",
  label: "Claude Code",
  capabilities: {
    spawn: true, streamInput: true, interrupt: true, resume: true, fork: true,
    registry: true, gates: true, reportedCost: true, harness: true,
  },

  buildSpawn({ cwd, prompt, sessionId, resume, fork, model, permissionMode, settingsFile, incognito, maxTurns, streamInput = true }) {
    const args = ["-p"];
    // With --input-format=stream-json the prompt arrives on stdin as JSON.
    // Passing it positionally as well makes the CLI wait for input forever.
    if (prompt && !resume && !streamInput) args.push(prompt);
    args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
    if (streamInput) args.push("--input-format", "stream-json");
    if (sessionId && !resume) args.push("--session-id", sessionId);
    if (resume) args.push("--resume", resume);
    if (fork) args.push("--fork-session");
    if (model) args.push("--model", model);
    if (permissionMode) args.push("--permission-mode", permissionMode);
    if (settingsFile) args.push("--settings", settingsFile);
    // Decision 07: incognito writes nothing — no transcript, nothing resumable.
    if (incognito) args.push("--no-session-persistence");
    if (maxTurns) args.push("--max-turns", String(maxTurns));
    return { cmd: "claude", args, cwd, env: { ...process.env, ABCD_RUN: "1" } };
  },

  parseEvent(line) {
    let j;
    try { j = JSON.parse(line); } catch { return null; }
    const t = j.type;

    if (t === "system" && j.subtype === "init") {
      return { kind: EVENT.INIT, sessionId: j.session_id, cwd: j.cwd, model: j.model,
        permissionMode: j.permissionMode, tools: j.tools?.length ?? 0,
        skills: j.skills?.length ?? 0, version: j.claude_code_version, raw: j };
    }
    if (t === "system" && (j.subtype === "hook_started" || j.subtype === "hook_response")) {
      return { kind: EVENT.HOOK, phase: j.subtype === "hook_started" ? "start" : "end", name: j.hook_name ?? j.hookName ?? null };
    }
    if (t === "system" && j.subtype === "status") return { kind: EVENT.STATUS, raw: j };
    if (t === "rate_limit_event") return { kind: EVENT.RATE_LIMIT, raw: j };
    if (t === "stream_event") return { kind: EVENT.PARTIAL, raw: j };

    if (t === "assistant" && j.message) {
      const out = [];
      for (const c of j.message.content ?? []) {
        if (c.type === "text" && c.text) out.push({ kind: EVENT.TEXT, text: c.text });
        if (c.type === "thinking" && c.thinking) out.push({ kind: EVENT.THINKING, text: c.thinking });
        if (c.type === "tool_use") {
          const i = c.input ?? {};
          out.push({ kind: EVENT.TOOL_USE, id: c.id, name: c.name,
            summary: i.file_path || i.path || i.command || i.pattern || i.query || i.description || "" });
        }
      }
      return out.length === 1 ? out[0] : { kind: "batch", events: out, usage: j.message.usage ?? null };
    }
    if (t === "user" && j.message) {
      const has = (j.message.content ?? []).some((c) => c.type === "tool_result");
      if (has) return { kind: EVENT.TOOL_RESULT };
    }
    if (t === "result") {
      return { kind: EVENT.RESULT, ok: !j.is_error, sessionId: j.session_id,
        durationMs: j.duration_ms ?? null,
        /** The runtime's own figure. Measured, not derived from a price table. */
        reportedCostUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
        usage: j.usage ?? null, text: typeof j.result === "string" ? j.result : null };
    }
    return null;
  },

  /** Realtime input, matching --input-format=stream-json. */
  encodeInput(text) {
    return `${JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    })}\n`;
  },

  deriveStatus,
  parseTranscript: (file, id) => readTranscript(file, id),
});
