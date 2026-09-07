/**
 * Vault reader, bounded by construction.
 *
 * A knowledge folder can hold tens of thousands of notes and the tree may be
 * iCloud-backed, where a bulk walk hangs on evicted files. So: readdir the
 * known folders (one syscall each), take a capped slice, and head-read only
 * those. Backlinks come from the pre-computed Smart Connections footers that
 * already exist in the notes; nothing is recomputed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveVault } from "./paths.mjs";
import { readDir, readHead, clip } from "./fsutil.mjs";

/**
 * Read only the `tags:` field.
 *
 * Scanning the whole frontmatter for YAML bullets silently merges every other
 * list-valued key — `topics:`, `related:`, `team:` — into the tags. On the
 * reference vault that affected 24 of 397 notes, in one case surfacing
 * teammate names as tags.
 */
export function parseTags(block) {
  const inline = block.match(/^tags:\s*\[([^\]]*)\]\s*$/m);
  if (inline && inline[1] !== undefined) {
    return inline[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const lines = block.split("\n");
  const start = lines.findIndex((l) => /^tags:\s*$/.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l === undefined) break;
    const m = l.match(/^\s+-\s*(.+?)\s*$/);
    if (m && m[1]) { out.push(m[1].replace(/^["']|["']$/g, "")); continue; }
    if (/^\S/.test(l)) break; // next top-level key ends the tags block
    if (l.trim() === "") continue;
    break;
  }
  return out;
}

const FOLDERS = ["20-Projects", "30-Knowledge", "10-Sessions", "50-Wiki", "40-Resources"];

export async function readNotes({ max = 300 } = {}) {
  const VAULT = resolveVault();
  if (!VAULT) return { notes: [], vault: null };
  const notes = [];
  const per = Math.max(24, Math.floor(max / FOLDERS.length));

  for (const folder of FOLDERS) {
    const dir = path.join(VAULT, folder);
    const entries = await readDir(dir);
    if (!entries.length) continue;
    const picked = [];
    for (const e of entries) {
      if (picked.length >= per) break;
      if (e.isFile() && e.name.endsWith(".md")) picked.push(path.join(dir, e.name));
      else if (e.isDirectory()) {
        const idx = path.join(dir, e.name, "_index.md");
        try { await fs.access(idx); picked.push(idx); } catch { /* no index */ }
      }
    }
    for (const p of picked) {
      const raw = await readHead(p, 4000);
      if (!raw) continue;
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      const block = fm ? fm[1] : "";
      const title = (block.match(/^title:\s*"?([^"\n]+)"?/m)?.[1] || path.basename(p, ".md")).trim();
      const tags = parseTags(block).slice(0, 4);
      const links = [...raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1].trim()).slice(0, 6);
      const body = raw.replace(/^---[\s\S]*?---/, "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
      let updatedAt = new Date().toISOString();
      try { updatedAt = new Date((await fs.stat(p)).mtimeMs).toISOString(); } catch { /* keep */ }
      notes.push({ path: path.relative(VAULT, p), title: clip(title, 64), folder, tags, links, updatedAt, excerpt: clip(body, 190) });
    }
  }
  return { notes: notes.slice(0, max), vault: VAULT };
}

/**
 * Optional enrichment for the history index (decision 08). The vault's session
 * archive holds dates long after Claude Code has pruned its own transcripts.
 */
export async function readArchiveDates() {
  const VAULT = resolveVault();
  if (!VAULT) return [];
  const dates = new Set();
  const scan = async (dir) => {
    for (const e of await readDir(dir)) {
      const m = e.name.match(/(20\d{2}-\d{2}-\d{2})/);
      if (m && m[1]) dates.add(m[1]);
    }
  };
  await scan(path.join(VAULT, "10-Sessions"));
  for (const sub of ["claude-code", "sessions"]) await scan(path.join(VAULT, "10-Sessions", sub));
  return [...dates];
}
