/** Bounded filesystem helpers. Every read here is capped on purpose. */
import fs from "node:fs/promises";
import path from "node:path";
import { assertUnderHome } from "./paths.mjs";

export async function readJson(p) {
  try { return JSON.parse(await fs.readFile(assertUnderHome(p), "utf8")); } catch { return null; }
}

export async function readDir(p) {
  try { return await fs.readdir(assertUnderHome(p), { withFileTypes: true }); } catch { return []; }
}

/** Head-read only. Never pulls a whole file into memory. */
export async function readHead(p, cap = 8000) {
  let h = null;
  try {
    const full = assertUnderHome(p);
    const st = await fs.stat(full);
    if (!st.isFile()) return "";
    h = await fs.open(full, "r");
    const b = Buffer.alloc(cap);
    const { bytesRead } = await h.read(b, 0, cap, 0);
    return b.subarray(0, bytesRead).toString("utf8");
  } catch { return ""; }
  finally { if (h) await h.close().catch(() => {}); }
}

export const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const decodeProjectDir = (n) => n.replace(/^-/, "/").replace(/-/g, "/");
export { path };
