/**
 * Append-only NDJSON audit log. Answers "what did it do today?".
 * Read-only phase writes only reads; it still records them.
 */
import fs from "node:fs";
import { AUDIT_LOG, ensureAbcdDir } from "./paths.mjs";

let stream = null;

export function audit(kind, detail = {}) {
  try {
    if (!stream) {
      ensureAbcdDir();
      stream = fs.createWriteStream(AUDIT_LOG, { flags: "a" });
    }
    stream.write(`${JSON.stringify({ ts: new Date().toISOString(), kind, detail })}\n`);
  } catch { /* the log must never break the app */ }
}

export function readAudit(limit = 200) {
  try {
    const raw = fs.readFileSync(AUDIT_LOG, "utf8").trim().split("\n");
    return raw.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
