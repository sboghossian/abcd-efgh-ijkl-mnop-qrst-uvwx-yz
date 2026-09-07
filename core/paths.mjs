/**
 * Path resolution and the safety spine's first rule: every path abcd touches
 * is validated as being under $HOME. Nothing here imports Electron.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const HOME = os.homedir();
export const CLAUDE = path.join(HOME, ".claude");
export const PROJECTS = path.join(CLAUDE, "projects");
export const REGISTRY = path.join(CLAUDE, "sessions");
export const ABCD_DIR = path.join(HOME, ".abcd");
export const INDEX_DB = path.join(ABCD_DIR, "index.db");
export const AUDIT_LOG = path.join(ABCD_DIR, "audit.log");

/** Local, gitignored overrides. Never ship a personal path in the repo. */
export function localConfig() {
  for (const p of [
    process.env.ABCD_CONFIG,
    path.join(ABCD_DIR, "config.json"),
    new URL("../scripts/paths.local.json", import.meta.url).pathname,
  ].filter(Boolean)) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* next */ }
  }
  return {};
}

/**
 * Vault location: env, then local config, then a fixed candidate list.
 * Never a discovery scan — walking an iCloud tree hangs on evicted files.
 */
export function resolveVault() {
  const candidates = [
    process.env.ABCD_VAULT,
    localConfig().vault,
    path.join(HOME, "Documents/Obsidian"),
    path.join(HOME, "Obsidian"),
    path.join(HOME, "vault"),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* next */ }
  }
  return null;
}

/**
 * Safety spine: refuse any path outside $HOME, and refuse traversal.
 * Every reader calls this before it opens anything.
 */
export function assertUnderHome(p) {
  const resolved = path.resolve(p);
  const home = path.resolve(HOME);
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new Error(`refused: path outside $HOME (${resolved})`);
  }
  return resolved;
}

export function ensureAbcdDir() {
  fs.mkdirSync(ABCD_DIR, { recursive: true });
  return ABCD_DIR;
}

export const tilde = (p) => String(p ?? "").replace(HOME, "~");
