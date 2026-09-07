// Test suite for core/ modules. Uses only node:test (node --test).
//
// HERMETICITY / MODULE-CONSTANT WORKAROUND
// -----------------------------------------
// core/paths.mjs computes HOME, CLAUDE, PROJECTS, REGISTRY, ABCD_DIR, INDEX_DB
// and AUDIT_LOG as module-level constants from os.homedir() at import time.
// Nearly every other core/* module imports core/paths.mjs (directly or
// transitively), so those constants are fixed for the lifetime of the process
// the moment core/paths.mjs is first evaluated.
//
// To avoid ever touching the real ~/.abcd/index.db or the real ~/.claude, this
// file sets process.env.HOME to a freshly created temp directory BEFORE any
// core/* module is imported, then imports every core module with dynamic
// import() (static "import" statements are hoisted and would run before our
// own top-level code, defeating the purpose). Every core module therefore
// resolves its paths under a sandbox directory for the entire run.
//
// A second wrinkle: core/paths.mjs's localConfig() also reads a *repo-relative*
// file (scripts/paths.local.json, resolved via import.meta.url) which is NOT
// gated by HOME and, on the author's own machine, contains a real vault path.
// We neutralize that by pointing ABCD_CONFIG at an empty `{}` JSON file for the
// whole run (localConfig() returns on the first candidate that parses), which
// also keeps resolveVault() from accidentally discovering a real vault.
//
// core/grouping.mjs's loadRules() independently re-reads
// scripts/group-rules.local.json directly (not through localConfig()), which
// we cannot sandbox the same way. We avoid this entirely by always passing an
// explicit `rules` argument to groupFor() in tests, so loadRules() is never
// exercised — see the comment in the grouping describe block.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "abcd-test-home-"));
process.env.HOME = TMP_HOME;

// Neutralize localConfig()'s repo-relative fallback (see note above) so
// resolveVault()/loadRules() never pick up the real developer machine's
// gitignored scripts/paths.local.json.
const NEUTRAL_CONFIG_PATH = path.join(TMP_HOME, "neutral-config.json");
fs.writeFileSync(NEUTRAL_CONFIG_PATH, "{}");
process.env.ABCD_CONFIG = NEUTRAL_CONFIG_PATH;
delete process.env.ABCD_VAULT;

const Paths = await import("../core/paths.mjs");
const FsUtil = await import("../core/fsutil.mjs");
const AuditMod = await import("../core/audit.mjs");
const History = await import("../core/history.mjs");
const Registry = await import("../core/registry.mjs");
const Transcript = await import("../core/transcript.mjs");
const Grouping = await import("../core/grouping.mjs");
const Vault = await import("../core/vault.mjs");
const System = await import("../core/system.mjs");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fixturePath(name) {
  return new URL(`./fixtures/${name}`, import.meta.url);
}
function readFixture(name) {
  return fs.readFileSync(fixturePath(name), "utf8");
}
/** Copy a committed fixture's content into a fresh path under $HOME (required
 * because every core reader calls assertUnderHome() on the path it opens). */
function placeUnderHome(relDir, name, content) {
  const dir = path.join(TMP_HOME, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, content);
  return dest;
}

async function waitFor(fn, { tries = 40, delayMs = 25 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return fn();
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return res;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never became healthy on port ${port}: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// core/paths.mjs — safety spine
// ---------------------------------------------------------------------------

describe("paths.mjs — safety spine", () => {
  test("assertUnderHome accepts $HOME itself", () => {
    assert.equal(Paths.assertUnderHome(Paths.HOME), path.resolve(Paths.HOME));
  });

  test("assertUnderHome accepts a nested path under $HOME", () => {
    const p = path.join(Paths.HOME, "a", "b.txt");
    assert.equal(Paths.assertUnderHome(p), path.resolve(p));
  });

  test("assertUnderHome throws for /etc/passwd", () => {
    assert.throws(() => Paths.assertUnderHome("/etc/passwd"), /refused/);
  });

  test("assertUnderHome throws for /tmp/x", () => {
    assert.throws(() => Paths.assertUnderHome("/tmp/x"), /refused/);
  });

  test("assertUnderHome throws for $HOME/../../etc/passwd (traversal)", () => {
    assert.throws(
      () => Paths.assertUnderHome(`${Paths.HOME}/../../etc/passwd`),
      /refused/,
    );
  });

  test("tilde() replaces $HOME with ~", () => {
    const p = path.join(Paths.HOME, "a", "b");
    assert.equal(Paths.tilde(p), `~${path.sep}a${path.sep}b`);
  });

  test("tilde() is safe on null/undefined", () => {
    assert.equal(Paths.tilde(undefined), "");
    assert.equal(Paths.tilde(null), "");
  });

  test("ensureAbcdDir creates ~/.abcd under the sandboxed HOME", () => {
    const dir = Paths.ensureAbcdDir();
    assert.equal(dir, Paths.ABCD_DIR);
    assert.ok(fs.statSync(Paths.ABCD_DIR).isDirectory());
    // never the real user's directory
    assert.ok(Paths.ABCD_DIR.startsWith(TMP_HOME));
  });

  test("localConfig() returns the parsed content of ABCD_CONFIG when set", () => {
    const custom = path.join(TMP_HOME, "custom-config.json");
    fs.writeFileSync(custom, JSON.stringify({ vault: "/somewhere", groupRules: [] }));
    const prev = process.env.ABCD_CONFIG;
    process.env.ABCD_CONFIG = custom;
    try {
      assert.deepEqual(Paths.localConfig(), { vault: "/somewhere", groupRules: [] });
    } finally {
      process.env.ABCD_CONFIG = prev;
    }
    // NOTE: we do not test the "no config anywhere -> {}" fallback path. When
    // ABCD_CONFIG and ~/.abcd/config.json are both absent, localConfig() falls
    // through to a *repo-relative* file (scripts/paths.local.json) that is not
    // gated by $HOME. On a clean checkout that file doesn't exist and {} would
    // come back, but on the author's own machine it's a real gitignored file
    // with a real vault path, so asserting on that branch is not portable.
  });
});

// ---------------------------------------------------------------------------
// core/fsutil.mjs — bounded filesystem helpers
// ---------------------------------------------------------------------------

describe("fsutil.mjs — bounded fs helpers", () => {
  test("readJson returns null for a missing file", async () => {
    assert.equal(await FsUtil.readJson(path.join(TMP_HOME, "nope.json")), null);
  });

  test("readJson parses an existing file under $HOME", async () => {
    const dest = placeUnderHome("fsutil", "sample.json", readFixture("sample.json"));
    assert.deepEqual(await FsUtil.readJson(dest), { hello: "world", n: 42 });
  });

  test("readJson returns null (not a throw) for a path outside $HOME", async () => {
    const outside = path.join(os.tmpdir(), "outside-home.json");
    fs.writeFileSync(outside, "{}");
    try {
      assert.equal(await FsUtil.readJson(outside), null);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test("readDir returns [] for a missing directory", async () => {
    assert.deepEqual(await FsUtil.readDir(path.join(TMP_HOME, "no-such-dir")), []);
  });

  test("readDir lists an existing directory's entries", async () => {
    const dir = path.join(TMP_HOME, "fsutil-dir");
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a.txt"), "x");
    const entries = await FsUtil.readDir(dir);
    assert.equal(entries.length, 2);
    const file = entries.find((e) => e.name === "a.txt");
    const subdir = entries.find((e) => e.name === "sub");
    assert.ok(file.isFile());
    assert.ok(subdir.isDirectory());
  });

  test("readHead never returns more than its cap", async () => {
    const big = path.join(TMP_HOME, "big.txt");
    fs.writeFileSync(big, "x".repeat(30000));
    const head = await FsUtil.readHead(big, 100);
    assert.equal(head.length, 100);
    assert.equal(head, "x".repeat(100));
  });

  test("readHead returns '' for a directory", async () => {
    const dir = path.join(TMP_HOME, "a-directory");
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(await FsUtil.readHead(dir), "");
  });

  test("readHead returns '' for a missing file", async () => {
    assert.equal(await FsUtil.readHead(path.join(TMP_HOME, "missing.txt")), "");
  });
});

// ---------------------------------------------------------------------------
// core/audit.mjs
// ---------------------------------------------------------------------------
// IMPORTANT: this block must run before anything else in this file calls
// audit() (e.g. history.mjs's openIndex() calls audit("index.created", ...)
// the first time it runs). audit.mjs caches its write stream in a module-level
// variable on first use, so once ANY audit() call has happened the log file is
// guaranteed to exist for the rest of the process — we rely on file order
// (verified: node:test runs describe/test blocks in declaration order) to
// exercise the "log file doesn't exist yet" path truthfully.

describe("audit.mjs", () => {
  test("readAudit returns [] before any audit() call has ever happened", () => {
    assert.deepEqual(AuditMod.readAudit(), []);
  });

  test("audit() appends an NDJSON entry that readAudit() can see", async () => {
    AuditMod.audit("test.kind", { foo: "bar" });
    const found = await waitFor(() =>
      AuditMod.readAudit(200).find((e) => e.kind === "test.kind" && e.detail.foo === "bar"),
    );
    assert.ok(found, "expected the written entry to show up in readAudit()");
    assert.ok(typeof found.ts === "string" && found.ts.length > 0);
  });
});

// ---------------------------------------------------------------------------
// core/history.mjs — the index that must not lose data
// ---------------------------------------------------------------------------

describe("history.mjs — index (decision-08 guarantees)", () => {
  const tokens = (input, output, cacheRead = 0, cacheWrite = 0) => ({
    input,
    output,
    cacheRead,
    cacheWrite,
  });

  test("upsertSession twice with the same id yields exactly one row", () => {
    const before = History.indexStats().sessions;
    History.upsertSession({ id: "hist-idem-1", title: "A", lastActivityAt: "2026-01-01T00:00:00Z", tokens: tokens(1, 1) });
    History.upsertSession({ id: "hist-idem-1", title: "A updated", lastActivityAt: "2026-01-01T00:01:00Z", tokens: tokens(2, 2) });
    assert.equal(History.indexStats().sessions, before + 1);
  });

  test("re-upserting with LOWER token counts does not decrease stored values (MAX)", () => {
    History.upsertSession({ id: "hist-max-1", lastActivityAt: "2026-01-01T00:00:00Z", tokens: tokens(100, 50, 20, 10) });
    History.upsertSession({ id: "hist-max-1", lastActivityAt: "2026-01-01T00:00:00Z", tokens: tokens(10, 5, 1, 1) });
    const db = History.openIndex();
    const row = db.prepare("SELECT tok_in, tok_out, tok_cache_r, tok_cache_w FROM sessions WHERE id = ?").get("hist-max-1");
    assert.deepEqual(
      { tok_in: row.tok_in, tok_out: row.tok_out, tok_cache_r: row.tok_cache_r, tok_cache_w: row.tok_cache_w },
      { tok_in: 100, tok_out: 50, tok_cache_r: 20, tok_cache_w: 10 },
    );
  });

  test("re-upserting with HIGHER token counts raises the stored values", () => {
    History.upsertSession({ id: "hist-max-2", lastActivityAt: "2026-01-01T00:00:00Z", tokens: tokens(1, 1) });
    History.upsertSession({ id: "hist-max-2", lastActivityAt: "2026-01-01T00:00:00Z", tokens: tokens(999, 888) });
    const db = History.openIndex();
    const row = db.prepare("SELECT tok_in, tok_out FROM sessions WHERE id = ?").get("hist-max-2");
    assert.deepEqual({ tok_in: row.tok_in, tok_out: row.tok_out }, { tok_in: 999, tok_out: 888 });
  });

  test("recordDay called twice takes the max of sessions/tokens/cost", () => {
    History.recordDay("2026-02-02", { sessions: 1, tokens: 10, cost: 0.1, source: "index" });
    History.recordDay("2026-02-02", { sessions: 5, tokens: 999, cost: 9, source: "index" });
    const db = History.openIndex();
    const row = db.prepare("SELECT sessions, tokens, cost_est FROM days WHERE date = ?").get("2026-02-02");
    assert.deepEqual({ sessions: row.sessions, tokens: row.tokens, cost_est: row.cost_est }, { sessions: 5, tokens: 999, cost_est: 9 });
  });

  test("a day first recorded with source 'index' is NOT downgraded to 'vault' by a later vault write", () => {
    History.recordDay("2026-02-01", { sessions: 2, tokens: 100, cost: 1, source: "index" });
    // a later, lower-value vault backfill for the same date must not win the source column
    History.recordDay("2026-02-01", { sessions: 1, tokens: 50, cost: 0.5, source: "vault" });
    const db = History.openIndex();
    const row = db.prepare("SELECT sessions, tokens, source FROM days WHERE date = ?").get("2026-02-01");
    assert.equal(row.source, "index", "source must stay 'index', never be downgraded to 'vault'");
    assert.equal(row.sessions, 2, "MAX must still apply alongside the source guarantee");
    assert.equal(row.tokens, 100);
  });

  test("a day first recorded as 'vault' CAN be upgraded to 'index' later", () => {
    History.recordDay("2026-02-03", { sessions: 1, tokens: 10, cost: 0, source: "vault" });
    History.recordDay("2026-02-03", { sessions: 1, tokens: 10, cost: 0, source: "index" });
    const db = History.openIndex();
    const row = db.prepare("SELECT source FROM days WHERE date = ?").get("2026-02-03");
    assert.equal(row.source, "index");
  });

  test("usageSince(n) returns exactly n entries, newest last, zero-filled gaps", () => {
    const today = new Date().toISOString().slice(0, 10);
    History.recordDay(today, { sessions: 3, tokens: 300, cost: 3, source: "index" });
    const rows = History.usageSince(3);
    assert.equal(rows.length, 3);
    assert.equal(rows[2].date, today);
    assert.equal(rows[2].sessions, 3);
    assert.equal(rows[2].tokens, 300);
    // two days ago was never touched by any test (all history fixtures above
    // use dates in February 2026, far from the real "today" in September) so
    // it must come back zero-filled.
    assert.equal(rows[0].sessions, 0);
    assert.equal(rows[0].tokens, 0);
    assert.equal(rows[0].source, "none");
    // strictly ascending dates
    assert.ok(rows[0].date < rows[1].date && rows[1].date < rows[2].date);
  });

  test("indexStats() counts match what was inserted (delta-based, DB is shared across tests)", () => {
    const before = History.indexStats();
    History.upsertSession({ id: "hist-stats-1", lastActivityAt: "2026-03-01T00:00:00Z", tokens: tokens(1, 1) });
    History.upsertTurns("hist-stats-1", [{ uuid: "t1", role: "user", at: "2026-03-01T00:00:00Z", text: "hi" }]);
    History.upsertFiles("hist-stats-1", [{ path: "/a/b.md", kind: "file", at: "2026-03-01T00:00:00Z" }]);
    History.recordDay("2026-03-01", { sessions: 1, tokens: 2, cost: 0, source: "index" });
    const after = History.indexStats();
    assert.equal(after.sessions, before.sessions + 1);
    assert.equal(after.turns, before.turns + 1);
    assert.equal(after.files, before.files + 1);
    assert.equal(after.days, before.days + 1);
    assert.equal(after.daysFromIndex, before.daysFromIndex + 1);
  });

  test("upsertTurns/upsertFiles are idempotent on (session_id, uuid)/(session_id, path)", () => {
    History.upsertSession({ id: "hist-dupe-1", lastActivityAt: "2026-03-02T00:00:00Z", tokens: tokens(1, 1) });
    History.upsertTurns("hist-dupe-1", [{ uuid: "t1", role: "user", at: "x", text: "hi" }]);
    History.upsertTurns("hist-dupe-1", [{ uuid: "t1", role: "user", at: "x", text: "hi (again)" }]);
    History.upsertFiles("hist-dupe-1", [{ path: "/x.md", kind: "file", at: "x" }]);
    History.upsertFiles("hist-dupe-1", [{ path: "/x.md", kind: "file", at: "x" }]);
    const db = History.openIndex();
    const turnCount = db.prepare("SELECT COUNT(*) AS n FROM turns WHERE session_id = ?").get("hist-dupe-1").n;
    const fileCount = db.prepare("SELECT COUNT(*) AS n FROM files_touched WHERE session_id = ?").get("hist-dupe-1").n;
    assert.equal(turnCount, 1);
    assert.equal(fileCount, 1);
  });
});

// ---------------------------------------------------------------------------
// core/registry.mjs
// ---------------------------------------------------------------------------

describe("registry.mjs", () => {
  test("readRegistry() returns an empty Map when ~/.claude/sessions doesn't exist", async () => {
    const map = await Registry.readRegistry();
    assert.equal(map.size, 0);
  });

  test("readRegistry() filters out entries whose pid is not alive", async () => {
    placeUnderHome(
      ".claude/sessions",
      "dead.json",
      JSON.stringify({ sessionId: "dead-session", pid: 2147483647, cwd: "/tmp", startedAt: "2026-01-01T00:00:00Z" }),
    );
    const map = await Registry.readRegistry();
    assert.equal(map.has("dead-session"), false);
  });

  test("readRegistry() includes entries whose pid IS alive", async () => {
    placeUnderHome(
      ".claude/sessions",
      "alive.json",
      JSON.stringify({
        sessionId: "alive-session",
        pid: process.pid,
        cwd: "/tmp/proj",
        startedAt: "2026-01-01T00:00:00Z",
        version: "2.1.178",
        messagingSocketPath: "/tmp/sock",
      }),
    );
    const map = await Registry.readRegistry();
    const entry = map.get("alive-session");
    assert.ok(entry);
    assert.equal(entry.cwd, "/tmp/proj");
    assert.equal(entry.hasSocket, true);
  });

  test("tierFor: no live process -> 3", () => {
    assert.equal(Registry.tierFor(null), 3);
  });

  // Reach is gated on what the PEER advertises, never on a CLI version string,
  // which goes stale the moment the user updates.
  const peer = (over = {}) => ({
    hasSocket: true, keyFile: "/x/1.key", peerProtocol: 1, peerFeatures: [], ...over,
  });

  test("tierFor: a session without a socket is tier 1, never tier 2", () => {
    assert.equal(Registry.tierFor(peer({ hasSocket: false })), 1);
  });

  test("tierFor: a socket without a peer token is tier 1", () => {
    assert.equal(Registry.tierFor(peer({ keyFile: null })), 1);
  });

  test("tierFor: a supported peer protocol reaches tier 2", () => {
    assert.equal(Registry.tierFor(peer()), 2);
  });

  test("tierFor: an unknown peer protocol degrades to tier 1, it does not guess", () => {
    assert.equal(Registry.tierFor(peer({ peerProtocol: 99 })), 1);
    assert.equal(Registry.tierFor(peer({ peerProtocol: null })), 1);
  });

  test("tierFor: a NEW CLI version alone must not change the tier", () => {
    // The whole point of gating on peerProtocol: bumping the CLI must not
    // silently downgrade every session the way a version allowlist would.
    assert.equal(Registry.tierFor(peer({ version: "9.9.9" })), 2);
  });

  test("reachReason: says why, in words, for each way reach fails", () => {
    assert.match(Registry.reachReason(null), /not running/i);
    assert.match(Registry.reachReason(peer({ hasSocket: false })), /socket/i);
    assert.match(Registry.reachReason(peer({ keyFile: null })), /token/i);
    assert.match(Registry.reachReason(peer({ peerProtocol: 99 })), /protocol/i);
    assert.equal(Registry.reachReason(peer()), "reachable");
  });
});

// ---------------------------------------------------------------------------
// core/transcript.mjs
// ---------------------------------------------------------------------------

describe("transcript.mjs — parsing", () => {
  test("token totals accumulate across all four usage fields; malformed line is skipped", async () => {
    const dest = placeUnderHome("transcripts", "full.jsonl", readFixture("transcript-full.jsonl"));
    const a = await Transcript.readTranscript(dest, "sess-full");
    assert.deepEqual(a.tokens, { input: 120, output: 60, cacheRead: 10, cacheWrite: 5 });
  });

  test("a Write tool_use produces a files entry; a /memory/ path is classified kind:'memory'", async () => {
    const dest = placeUnderHome("transcripts", "full2.jsonl", readFixture("transcript-full.jsonl"));
    const a = await Transcript.readTranscript(dest, "sess-full2");
    assert.equal(a.files.length, 1);
    assert.equal(a.files[0].kind, "memory");
    assert.match(a.files[0].path, /\/memory\//);
  });

  test("ai-title line is captured on the accumulator", async () => {
    const dest = placeUnderHome("transcripts", "full3.jsonl", readFixture("transcript-full.jsonl"));
    const a = await Transcript.readTranscript(dest, "sess-full3");
    assert.equal(a.aiTitle, "Fix login bug in auth.js");
  });

  test("pendingTool is true right after a tool_use with no matching tool_result yet", async () => {
    const dest = placeUnderHome("transcripts", "pending.jsonl", readFixture("transcript-pending.jsonl"));
    const a = await Transcript.readTranscript(dest, "sess-pending");
    assert.equal(a.pendingTool, true);
  });

  test("pendingTool is false once the matching tool_result has been ingested", async () => {
    const dest = placeUnderHome("transcripts", "full4.jsonl", readFixture("transcript-full.jsonl"));
    const a = await Transcript.readTranscript(dest, "sess-full4");
    assert.equal(a.pendingTool, false);
  });

  test("the byte cap is honoured: a tiny maxBytes truncates and sets truncated=true", async () => {
    const dest = placeUnderHome("transcripts", "full5.jsonl", readFixture("transcript-full.jsonl"));
    const a = await Transcript.readTranscript(dest, "sess-full5", 10);
    assert.equal(a.truncated, true);
    assert.deepEqual(a.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  test("titleFor prefers a custom title over everything else", () => {
    assert.equal(Transcript.titleFor({ title: "Custom Title", aiTitle: "AI Title" }), "Custom Title");
  });

  test("titleFor falls back to the ai-title when there is no custom title", () => {
    assert.equal(Transcript.titleFor({ title: null, aiTitle: "AI generated title" }), "AI generated title");
  });

  test("titleFor rejects a 'You are a...' prompt and falls through to the next candidate", () => {
    const a = {
      title: null,
      aiTitle: null,
      prompts: ["You are a helpful assistant embedded in a workflow", "Please refactor the payment module"],
    };
    assert.equal(Transcript.titleFor(a), "Refactor the payment module");
  });

  test("titleFor rejects an 'Approach this as...' prompt and falls through to the next candidate", () => {
    const a = {
      title: null,
      aiTitle: null,
      prompts: ["Approach this as a senior engineer reviewing code", "Add input validation to the signup form"],
    };
    assert.equal(Transcript.titleFor(a), "Add input validation to the signup form");
  });

  test("titleFor never returns 'HEAD' for a detached-HEAD branch", () => {
    const a = { title: null, aiTitle: null, prompts: [], firstPrompt: null, gitBranch: "HEAD" };
    assert.equal(Transcript.titleFor(a), "Untitled session");
  });

  test("titleFor DOES fall back to a real branch name when there are no usable prompts", () => {
    const a = { title: null, aiTitle: null, prompts: [], firstPrompt: null, gitBranch: "feature/checkout" };
    assert.equal(Transcript.titleFor(a), "feature/checkout");
  });
});

// ---------------------------------------------------------------------------
// core/grouping.mjs — decision 20
// ---------------------------------------------------------------------------
// NOTE: groupFor(signal, cwd, rules) is always called here with an explicit
// `rules` array rather than relying on its default `rules = loadRules()`.
// loadRules() independently reads a repo-relative, gitignored
// scripts/group-rules.local.json (not routed through localConfig()/ABCD_CONFIG),
// so it isn't sandboxable the way the rest of this suite is; passing explicit
// rules tests the real decision-20 semantics without depending on that file.

describe("grouping.mjs — decision 20", () => {
  const RULES = [
    ["HAQQ", /\bhaqq\b/i],
    ["Notes", /obsidian|vault|second brain/i],
  ];

  test("a cwd inside a repo root wins over a conflicting content signal", () => {
    const cwd = "/Users/x/Documents/Code/my-cool-project";
    const signal = "obsidian vault second brain notes about this project";
    assert.equal(Grouping.groupFor(signal, cwd, RULES), "My Cool Project");
  });

  test("with cwd at $HOME, the content signal decides", () => {
    const signal = "obsidian vault second brain notes";
    assert.equal(Grouping.groupFor(signal, Paths.HOME, RULES), "Notes");
  });

  test("neither cwd nor content signal matching returns 'Ad hoc'", () => {
    assert.equal(Grouping.groupFor("nothing relevant here", Paths.HOME, RULES), "Ad hoc");
  });

  test("estimateCost scales with model tier for identical tokens (opus > sonnet > haiku)", () => {
    const t = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 };
    const opus = Grouping.estimateCost("claude-opus-4-8", t);
    const sonnet = Grouping.estimateCost("claude-sonnet-4-6", t);
    const haiku = Grouping.estimateCost("claude-haiku-4-5", t);
    assert.ok(opus > sonnet, `${opus} should be > ${sonnet}`);
    assert.ok(sonnet > haiku, `${sonnet} should be > ${haiku}`);
  });

  test("estimateCost returns 0 for all-zero (or missing) tokens", () => {
    assert.equal(Grouping.estimateCost("claude-sonnet-4-6", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), 0);
    assert.equal(Grouping.estimateCost("claude-sonnet-4-6", {}), 0);
  });

  test("deriveStatus: no live process and sawFailed -> 'failed'", () => {
    assert.equal(Grouping.deriveStatus({ sawFailed: true }, null), "failed");
  });

  test("deriveStatus: no live process, otherwise -> 'completed'", () => {
    assert.equal(Grouping.deriveStatus({ sawFailed: false }, null), "completed");
  });

  test("deriveStatus: live + recent activity -> 'working'", () => {
    const now = Date.now();
    const a = { lastAt: new Date(now - 60_000).toISOString(), lastRole: "assistant", pendingTool: false };
    const live = { startedAt: new Date(now - 120_000).toISOString() };
    assert.equal(Grouping.deriveStatus(a, live, now), "working");
  });

  test("deriveStatus: live + stale + last role assistant -> 'needs-input'", () => {
    const now = Date.now();
    const a = { lastAt: new Date(now - 10 * 60_000).toISOString(), lastRole: "assistant", pendingTool: false };
    const live = { startedAt: new Date(now - 20 * 60_000).toISOString() };
    assert.equal(Grouping.deriveStatus(a, live, now), "needs-input");
  });

  test("deriveStatus: live + stale + last role user -> 'idle' (not needs-input)", () => {
    const now = Date.now();
    const a = { lastAt: new Date(now - 10 * 60_000).toISOString(), lastRole: "user", pendingTool: false };
    const live = { startedAt: new Date(now - 20 * 60_000).toISOString() };
    assert.equal(Grouping.deriveStatus(a, live, now), "idle");
  });
});

// ---------------------------------------------------------------------------
// core/vault.mjs
// ---------------------------------------------------------------------------

describe("vault.mjs", () => {
  test("readNotes() returns empty when no vault is configured", async () => {
    delete process.env.ABCD_VAULT;
    const { notes, vault } = await Vault.readNotes();
    assert.deepEqual(notes, []);
    assert.equal(vault, null);
  });

  test("readNotes() parses frontmatter, tags, wikilinks and falls back to filename for title", async () => {
    const vaultDir = fs.mkdtempSync(path.join(TMP_HOME, "vault-"));
    fs.mkdirSync(path.join(vaultDir, "20-Projects"), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, "30-Knowledge"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, "20-Projects", "my-note.md"),
      [
        "---",
        'title: "My Test Note"',
        "tags:",
        "  - project-x",
        "  - growth",
        "---",
        "# My Test Note",
        "",
        "This body mentions [[Other Note]] and [[Second Note|alias]] for cross-reference testing.",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(vaultDir, "30-Knowledge", "second-note.md"), "Just a plain note body, no frontmatter at all.");

    process.env.ABCD_VAULT = vaultDir;
    try {
      const { notes, vault } = await Vault.readNotes();
      assert.equal(vault, vaultDir);
      assert.equal(notes.length, 2);

      const noted = notes.find((n) => n.path.includes("my-note.md"));
      assert.equal(noted.title, "My Test Note");
      assert.equal(noted.folder, "20-Projects");
      assert.deepEqual(noted.tags, ["project-x", "growth"]);
      assert.deepEqual(noted.links, ["Other Note", "Second Note"]);
      assert.match(noted.excerpt, /This body mentions/);

      const second = notes.find((n) => n.path.includes("second-note.md"));
      assert.equal(second.title, "second-note"); // falls back to filename, no frontmatter
    } finally {
      delete process.env.ABCD_VAULT;
      fs.rmSync(vaultDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// core/system.mjs
// ---------------------------------------------------------------------------

describe("system.mjs", () => {
  test("readSystem() returns sane defaults when ~/.claude is empty/absent", async () => {
    const sys = await System.readSystem();
    assert.equal(sys.counts.skills, 0);
    assert.equal(sys.counts.agents, 0);
    assert.equal(sys.counts.hooks, 0);
    assert.equal(sys.settings.model, "claude-sonnet-4-6");
    assert.deepEqual(sys.settings.allow, []);
    assert.deepEqual(sys.settings.deny, []);
    assert.equal(sys.nodes.length, 12);
    assert.ok(sys.nodes.some((n) => n.id === "n-claude"));
    assert.deepEqual(sys.routines, []);
  });

  test("readSystem() merges settings.json's model and permissions", async () => {
    placeUnderHome(
      ".claude",
      "settings.json",
      JSON.stringify({
        model: "claude-opus-4-8",
        permissions: { allow: ["Bash(git *)"], deny: ["Bash(rm -rf *)"] },
      }),
    );
    const sys = await System.readSystem();
    assert.equal(sys.settings.model, "claude-opus-4-8");
    assert.ok(sys.settings.allow.includes("Bash(git *)"));
    assert.ok(sys.settings.deny.includes("Bash(rm -rf *)"));
  });
});

// ---------------------------------------------------------------------------
// server.mjs — integration (spawned as a child process, its own sandboxed HOME)
// ---------------------------------------------------------------------------

const SERVER_ENTRY = fileURLToPath(new URL("../server.mjs", import.meta.url));
const REQUIRED_STATE_KEYS = [
  "user", "demo", "today", "groups", "sessions", "turns", "outputs",
  "tasks", "routines", "notes", "systemNodes", "systemEdges", "usage", "settings",
];

describe("server.mjs", () => {
  let child;
  let port;
  let SERVER_HOME;

  before(async () => {
    SERVER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "abcd-test-server-home-"));
    port = await getFreePort();
    child = spawn(process.execPath, [SERVER_ENTRY], {
      env: {
        ...process.env,
        HOME: SERVER_HOME,
        ABCD_PORT: String(port),
        ABCD_VAULT: "",
        ABCD_CONFIG: NEUTRAL_CONFIG_PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    await waitForHealth(port);
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill();
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2000);
      });
    }
    fs.rmSync(SERVER_HOME, { recursive: true, force: true });
  });

  test("GET /api/health returns ok:true", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  test("POST /api/state returns 405 (read-only phase)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { method: "POST" });
    assert.equal(res.status, 405);
  });

  test("an unknown path returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
    assert.equal(res.status, 404);
  });

  test("GET /api/state returns {state, meta} with all required state keys", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.state);
    assert.ok(body.meta);
    for (const key of REQUIRED_STATE_KEYS) {
      assert.ok(key in body.state, `state is missing required key "${key}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// global cleanup
// ---------------------------------------------------------------------------

after(() => {
  History.closeIndex();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});
