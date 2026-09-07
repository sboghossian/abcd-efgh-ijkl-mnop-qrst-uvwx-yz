#!/usr/bin/env node
/**
 * PreToolUse hook. Runs as a child of the Claude Code process abcd spawned.
 *
 * FAIL-CLOSED. The runtime treats its own hook timeout as "proceed", so this
 * hook must decide first. It waits a bounded time for a human and then DENIES.
 * Silence is a denial.
 *
 * Contract:
 *   stdin  {session_id, cwd, hook_event_name, tool_name, tool_input, tool_use_id, ...}
 *   stdout {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny",...}}
 *   exit 2 blocks unconditionally and overrides any JSON "allow"
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const GATES = path.join(os.homedir(), ".abcd", "gates");
const WAIT_MS = Number(process.env.ABCD_GATE_WAIT_MS || 120_000);
const POLL_MS = 250;

const read = () => new Promise((res) => {
  let d = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { d += c; });
  process.stdin.on("end", () => res(d));
  setTimeout(() => res(d), 3000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  if (decision === "deny") {
    process.stderr.write(reason);
    process.exit(2); // unconditional block; overrides any allow
  }
  process.exit(0);
}

const main = async () => {
  let input = {};
  try { input = JSON.parse(await read()); } catch { /* fail closed below */ }

  const tool = input.tool_name ?? "unknown";
  const ti = input.tool_input ?? {};
  const id = input.tool_use_id || `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  fs.mkdirSync(GATES, { recursive: true });
  const req = {
    id, at: new Date().toISOString(),
    sessionId: input.session_id ?? null, cwd: input.cwd ?? null,
    tool, filePath: ti.file_path ?? ti.path ?? null,
    summary: ti.file_path || ti.path || ti.command || ti.pattern || ti.url || "",
    command: ti.command ?? null,
    input: ti,
    waitMs: WAIT_MS,
  };
  fs.writeFileSync(path.join(GATES, `${id}.request.json`), JSON.stringify(req, null, 2));

  const decisionFile = path.join(GATES, `${id}.decision.json`);
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(decisionFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(decisionFile, "utf8"));
        return emit(d.decision === "allow" ? "allow" : "deny", d.reason || `abcd: ${d.decision}`);
      } catch { /* partially written; keep polling */ }
    }
    await sleep(POLL_MS);
  }
  // Nobody answered. Silence is a denial — never let the runtime's own
  // timeout arrive, because that would let the tool through.
  emit("deny", "abcd: no human decision within the gate window; denied by default");
};

main().catch((e) => emit("deny", `abcd gate error: ${String(e?.message || e)}`));
