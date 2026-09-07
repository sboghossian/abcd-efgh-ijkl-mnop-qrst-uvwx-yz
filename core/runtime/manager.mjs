/**
 * RunManager — owns the child processes abcd spawns.
 *
 * The lifecycle is a state machine with a `canRun` guard, so a run cannot be
 * fired twice, and every transition is auditable:
 *
 *   idle → starting → running ⇄ needs_approval → awaiting_input → done | failed | interrupted
 *
 * With --input-format=stream-json the process does NOT exit when a turn ends:
 * it waits for the next message. So a `result` event means TURN complete, not
 * RUN complete. The run ends when stdin is closed, interrupted, or it fails.
 * Conflating the two is why a naive wait-for-exit hangs forever.
 *
 * Sessions abcd starts are tier 1: full control, over documented CLI flags
 * only. Nothing here touches the private socket — that is tier 2, Phase 3.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import crypto from "node:crypto";
import { getRuntime } from "./adapter.mjs";
import { EVENT } from "./adapter.mjs";
import { assertUnderHome } from "../paths.mjs";
import { audit } from "../audit.mjs";

const TERMINAL = new Set(["done", "failed", "interrupted"]);

class Run extends EventEmitter {
  constructor({ id, runtimeId, cwd, opts }) {
    super();
    this.id = id;
    this.runtimeId = runtimeId;
    this.runtime = getRuntime(runtimeId);
    this.cwd = cwd;
    this.opts = opts;
    this.state = "idle";
    this.child = null;
    this.sessionId = opts.sessionId ?? null;
    this.startedAt = null;
    this.endedAt = null;
    this.events = [];
    this.text = "";
    this.toolCalls = [];
    this.reportedCostUsd = null;
    this.usage = null;
    this.error = null;
    this.exitCode = null;
    this.turns = 0;
    this.streamsInput = Boolean(this.runtime?.capabilities?.streamInput);
  }

  get canRun() { return this.state === "idle"; }

  setState(next, detail = {}) {
    if (this.state === next) return;
    this.state = next;
    this.emit("state", { id: this.id, state: next, ...detail });
    audit("run.state", { run: this.id, state: next, ...detail });
  }

  start() {
    if (!this.canRun) throw new Error(`run ${this.id} already ${this.state}`);
    if (!this.runtime) throw new Error(`unknown runtime "${this.runtimeId}"`);
    assertUnderHome(this.cwd);

    const spec = this.runtime.buildSpawn({ ...this.opts, cwd: this.cwd });
    this.setState("starting", { cmd: spec.cmd });
    this.startedAt = new Date().toISOString();

    this.child = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd, env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.#onLine(line));

    let stderr = "";
    this.child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });

    this.child.on("error", (e) => {
      this.error = String(e?.message || e);
      this.setState("failed", { error: this.error });
      this.emit("done", this);
    });

    this.child.on("close", (code) => {
      this.exitCode = code;
      this.endedAt = new Date().toISOString();
      rl.close();
      if (TERMINAL.has(this.state)) { this.emit("done", this); return; }
      if (code === 0) this.setState("done");
      else { this.error = stderr.trim().slice(-800) || `exit ${code}`; this.setState("failed", { code }); }
      this.emit("done", this);
    });

    this.setState("running");

    // In streamed-input mode the opening prompt is the first stdin message.
    if (this.streamsInput && this.opts.prompt) {
      this.child.stdin.write(this.runtime.encodeInput(this.opts.prompt));
    } else if (!this.streamsInput) {
      try { this.child.stdin.end(); } catch { /* already closed */ }
    }
    return this;
  }

  #push(ev) {
    if (!ev) return;
    if (ev.kind === "batch") { for (const e of ev.events) this.#push(e); return; }
    this.events.push(ev);
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);

    if (ev.kind === EVENT.INIT && ev.sessionId) this.sessionId = ev.sessionId;
    if (ev.kind === EVENT.TEXT) this.text += ev.text;
    if (ev.kind === EVENT.TOOL_USE) this.toolCalls.push({ id: ev.id, name: ev.name, summary: ev.summary });
    if (ev.kind === EVENT.RESULT) {
      // The runtime's own cost figure. Measured, not derived from a price table.
      // Costs accumulate across turns within one run.
      if (typeof ev.reportedCostUsd === "number") {
        this.reportedCostUsd = (this.reportedCostUsd ?? 0) + ev.reportedCostUsd;
      }
      this.usage = ev.usage;
      this.turns += 1;
      if (!ev.ok) this.error = ev.text || "runtime reported an error";
      this.emit("turn", { runId: this.id, turn: this.turns, ok: ev.ok, text: this.text });
      // A finished turn is not a finished run when input is streamed.
      if (this.streamsInput && !TERMINAL.has(this.state)) this.setState("awaiting_input");
    }
    this.emit("event", { runId: this.id, ...ev });
  }

  #onLine(line) {
    if (!line.trim()) return;
    try { this.#push(this.runtime.parseEvent(line)); }
    catch (e) { this.emit("event", { runId: this.id, kind: EVENT.ERROR, text: String(e?.message || e) }); }
  }

  /** Follow-up message, no respawn. Requires streamInput capability. */
  send(text) {
    if (!this.runtime.capabilities.streamInput) throw new Error(`${this.runtimeId} cannot take streamed input`);
    if (!["running", "awaiting_input"].includes(this.state)) throw new Error(`run ${this.id} is ${this.state}`);
    this.child.stdin.write(this.runtime.encodeInput(text));
    this.setState("running");
    audit("run.send", { run: this.id, chars: text.length });
    return true;
  }

  /** Close stdin so the runtime finishes and exits cleanly. */
  end() {
    if (!this.child || TERMINAL.has(this.state)) return false;
    try { this.child.stdin.end(); } catch { /* already closed */ }
    return true;
  }

  /** SIGINT, the same signal an interactive Ctrl-C sends. The session survives. */
  interrupt() {
    if (!this.child || TERMINAL.has(this.state)) return false;
    this.setState("interrupted");
    this.child.kill("SIGINT");
    return true;
  }

  /** Last resort. SIGKILL can strand a half-written file, so it is never default. */
  kill() {
    if (!this.child) return false;
    this.child.kill("SIGKILL");
    return true;
  }

  summary() {
    return {
      id: this.id, runtimeId: this.runtimeId, state: this.state, cwd: this.cwd,
      sessionId: this.sessionId, startedAt: this.startedAt, endedAt: this.endedAt,
      events: this.events.length, toolCalls: this.toolCalls.length, turns: this.turns,
      text: this.text.slice(-4000), reportedCostUsd: this.reportedCostUsd,
      usage: this.usage, error: this.error, exitCode: this.exitCode,
      incognito: Boolean(this.opts.incognito),
    };
  }
}

export class RunManager extends EventEmitter {
  constructor({ maxConcurrent = 8 } = {}) {
    super();
    this.runs = new Map();
    this.maxConcurrent = maxConcurrent;
  }

  get active() {
    return [...this.runs.values()].filter((r) => !TERMINAL.has(r.state)).length;
  }

  create({ runtimeId = "claude", cwd, ...opts }) {
    if (this.active >= this.maxConcurrent) throw new Error(`concurrency cap reached (${this.maxConcurrent})`);
    const id = `run_${crypto.randomUUID().slice(0, 8)}`;
    const run = new Run({ id, runtimeId, cwd, opts: { sessionId: crypto.randomUUID(), ...opts } });
    run.on("event", (e) => this.emit("event", e));
    run.on("state", (e) => this.emit("state", e));
    run.on("done", (r) => this.emit("done", r.summary()));
    this.runs.set(id, run);
    return run;
  }

  get(id) { return this.runs.get(id) ?? null; }
  list() { return [...this.runs.values()].map((r) => r.summary()); }

  interruptAll() {
    let n = 0;
    for (const r of this.runs.values()) if (r.interrupt()) n++;
    audit("run.interruptAll", { count: n });
    return n;
  }
}

export const manager = new RunManager();
