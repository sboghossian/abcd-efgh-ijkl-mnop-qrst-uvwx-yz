/**
 * The permission gate — the trust primitive.
 *
 * abcd injects a PreToolUse hook via `--settings`, which MERGES with the user's
 * own settings rather than replacing them, so their hooks keep working.
 *
 * FAIL-CLOSED BY CONSTRUCTION. The runtime's own hook timeout fails OPEN: if a
 * hook exceeds it, the tool proceeds. So the hook must never let that timeout
 * arrive. It decides within its own shorter budget and denies explicitly.
 * A human who does not answer is a denial, not an allowance.
 *
 * Wire format is files, not HTTP, so a gate survives an abcd restart and is
 * trivially inspectable:
 *   ~/.abcd/gates/<id>.request.json   written by the hook, read by abcd
 *   ~/.abcd/gates/<id>.decision.json  written by abcd, read by the hook
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ABCD_DIR, ensureAbcdDir } from "../paths.mjs";
import { audit } from "../audit.mjs";

export const GATES_DIR = path.join(ABCD_DIR, "gates");
export const SNAPSHOT_DIR = path.join(ABCD_DIR, "snapshots");

/** Tools that can change something. Everything else is auto-allowed. */
const MUTATING = /^(Write|Edit|NotebookEdit|Bash|WebFetch|Task)$/;
/** Regex for the hook matcher in settings. */
export const GATE_MATCHER = "Write|Edit|NotebookEdit|Bash";

export function ensureGateDirs() {
  ensureAbcdDir();
  fs.mkdirSync(GATES_DIR, { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

/**
 * Settings injected into a run. Only the PreToolUse key is set, so every other
 * setting the user has — including their own hooks — is preserved by the merge.
 */
export function buildGateSettings({ hookPath, timeoutSec = 600 }) {
  return {
    hooks: {
      PreToolUse: [
        { matcher: GATE_MATCHER, hooks: [{ type: "command", command: `node ${hookPath}`, timeout: timeoutSec }] },
      ],
    },
  };
}

export function writeGateSettingsFile(runId, hookPath) {
  ensureGateDirs();
  const file = path.join(GATES_DIR, `${runId}.settings.json`);
  fs.writeFileSync(file, JSON.stringify(buildGateSettings({ hookPath }), null, 2));
  return file;
}

/** Pre-action snapshot so an approved change can be reverted with proof. */
export function snapshotFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { path: filePath, existed: false, sha256: null, snapshot: null };
    const buf = fs.readFileSync(filePath);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    ensureGateDirs();
    const snap = path.join(SNAPSHOT_DIR, `${sha256}.snap`);
    if (!fs.existsSync(snap)) fs.writeFileSync(snap, buf);
    return { path: filePath, existed: true, sha256, snapshot: snap };
  } catch (e) {
    return { path: filePath, existed: false, sha256: null, snapshot: null, error: String(e?.message || e) };
  }
}

/**
 * Restore a snapshot, refusing if the file changed again since — the sha256 is
 * checked before anything is overwritten, so a revert never silently clobbers
 * work done after the snapshot was taken.
 */
export function revertFile(snap, { expectCurrentSha = null } = {}) {
  if (!snap?.snapshot) return { ok: false, reason: "no snapshot" };
  try {
    if (expectCurrentSha && fs.existsSync(snap.path)) {
      const cur = crypto.createHash("sha256").update(fs.readFileSync(snap.path)).digest("hex");
      if (cur !== expectCurrentSha) return { ok: false, reason: "file changed since snapshot (drift)", current: cur };
    }
    fs.copyFileSync(snap.snapshot, snap.path);
    audit("gate.revert", { path: snap.path, sha256: snap.sha256 });
    return { ok: true, restored: snap.path, sha256: snap.sha256 };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export function listPending() {
  ensureGateDirs();
  const out = [];
  for (const f of fs.readdirSync(GATES_DIR)) {
    if (!f.endsWith(".request.json")) continue;
    const id = f.replace(/\.request\.json$/, "");
    if (fs.existsSync(path.join(GATES_DIR, `${id}.decision.json`))) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(GATES_DIR, f), "utf8"))); } catch { /* skip */ }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function decide(id, decision, reason = "") {
  if (!["allow", "deny"].includes(decision)) throw new Error(`bad decision "${decision}"`);
  ensureGateDirs();
  const reqFile = path.join(GATES_DIR, `${id}.request.json`);
  if (!fs.existsSync(reqFile)) return { ok: false, reason: "no such pending gate" };
  const req = JSON.parse(fs.readFileSync(reqFile, "utf8"));

  // Snapshot BEFORE allowing, so revert is possible even if the tool succeeds.
  let snapshot = null;
  if (decision === "allow" && req.filePath) snapshot = snapshotFile(req.filePath);

  fs.writeFileSync(path.join(GATES_DIR, `${id}.decision.json`),
    JSON.stringify({ id, decision, reason, at: new Date().toISOString(), snapshot }, null, 2));
  audit("gate.decide", { id, decision, tool: req.tool, path: req.filePath ?? null });
  return { ok: true, id, decision, snapshot };
}

export const isMutating = (tool) => MUTATING.test(String(tool || ""));
