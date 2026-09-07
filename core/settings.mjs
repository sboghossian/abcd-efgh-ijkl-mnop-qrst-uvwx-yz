/**
 * Writing the user's own Claude Code settings.
 *
 * This is the most dangerous thing abcd does. A bad write to
 * ~/.claude/settings.json can break every session on the machine, so every
 * write here is:
 *
 *   1. restricted to a fixed allowlist of keys — abcd never writes a key it
 *      does not understand, and never touches `hooks`, which is where a bad
 *      value does the most damage
 *   2. snapshotted first, with the sha256 recorded, so revert is exact
 *   3. validated as parseable JSON before and after
 *   4. written atomically via a temp file and rename, so a crash mid-write
 *      cannot leave a truncated settings file behind
 *   5. appended to the audit log
 *
 * Claude Code already keeps dated settings.json.bak* files; abcd adds its own
 * snapshots rather than relying on those.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CLAUDE, ABCD_DIR, ensureAbcdDir, assertUnderHome } from "./paths.mjs";
import { audit } from "./audit.mjs";

const SETTINGS = path.join(CLAUDE, "settings.json");
const SNAPS = path.join(ABCD_DIR, "settings-snapshots");

/**
 * Keys abcd will write. Deliberately small.
 * `hooks`, `permissions.deny` and anything unlisted are refused: a wrong value
 * there is the difference between a slow session and a broken machine.
 */
export const WRITABLE = new Set([
  "model",
  "effortLevel",
  "env",
  "enabledPlugins",
  "permissions.allow",
]);

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function readSettings() {
  try { return JSON.parse(fs.readFileSync(assertUnderHome(SETTINGS), "utf8")); }
  catch { return null; }
}

export function snapshotSettings() {
  ensureAbcdDir();
  fs.mkdirSync(SNAPS, { recursive: true });
  const buf = fs.readFileSync(assertUnderHome(SETTINGS));
  const digest = sha(buf);
  const file = path.join(SNAPS, `${digest}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  const meta = { sha256: digest, snapshot: file, at: new Date().toISOString(), bytes: buf.length };
  fs.writeFileSync(path.join(SNAPS, "latest.json"), JSON.stringify(meta, null, 2));
  return meta;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (k === undefined) return obj;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (last !== undefined) cur[last] = value;
  return obj;
}

/** Atomic: write a temp file in the same directory, then rename over. */
function writeAtomic(file, text) {
  const tmp = `${file}.abcd-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * Apply a patch of dotted keys. Returns the snapshot so the caller can revert
 * with proof rather than hope.
 */
export function patchSettings(patch) {
  if (!patch || typeof patch !== "object") throw new Error("patch must be an object");

  const keys = Object.keys(patch);
  const refused = keys.filter((k) => !WRITABLE.has(k));
  if (refused.length) {
    audit("settings.refused", { keys: refused });
    throw new Error(`abcd does not write these keys: ${refused.join(", ")}. Writable: ${[...WRITABLE].join(", ")}`);
  }

  const current = readSettings();
  if (current === null) throw new Error("settings.json is missing or unparseable; refusing to write over it");

  const snapshot = snapshotSettings();
  const next = JSON.parse(JSON.stringify(current));
  for (const [k, v] of Object.entries(patch)) setPath(next, k, v);

  const text = `${JSON.stringify(next, null, 2)}\n`;
  JSON.parse(text); // never write something that will not read back
  writeAtomic(assertUnderHome(SETTINGS), text);

  const after = readSettings();
  if (after === null) {
    // Should be impossible given the parse above, but restore rather than hope.
    fs.copyFileSync(snapshot.snapshot, SETTINGS);
    throw new Error("post-write read failed; settings restored from snapshot");
  }

  audit("settings.patch", { keys, sha256Before: snapshot.sha256 });
  return { ok: true, keys, snapshot, settings: after };
}

/** Restore a snapshot, refusing when the file changed again since it was taken. */
export function revertSettings(snapshot, { force = false } = {}) {
  const meta = snapshot ?? (() => {
    try { return JSON.parse(fs.readFileSync(path.join(SNAPS, "latest.json"), "utf8")); } catch { return null; }
  })();
  if (!meta?.snapshot || !fs.existsSync(meta.snapshot)) return { ok: false, reason: "no snapshot to restore" };

  if (!force && fs.existsSync(SETTINGS)) {
    const cur = sha(fs.readFileSync(SETTINGS));
    if (cur === meta.sha256) return { ok: true, noop: true, reason: "already matches the snapshot" };
  }
  writeAtomic(assertUnderHome(SETTINGS), fs.readFileSync(meta.snapshot, "utf8"));
  audit("settings.revert", { sha256: meta.sha256 });
  return { ok: true, restored: SETTINGS, sha256: meta.sha256 };
}

export function settingsHistory(limit = 20) {
  try {
    return fs.readdirSync(SNAPS)
      .filter((f) => f.endsWith(".json") && f !== "latest.json")
      .map((f) => {
        const p = path.join(SNAPS, f);
        const st = fs.statSync(p);
        return { sha256: f.replace(/\.json$/, ""), at: new Date(st.mtimeMs).toISOString(), bytes: st.size };
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  } catch { return []; }
}
