#!/usr/bin/env node
/**
 * Enforces the standing condition on decision 02: `core/` imports nothing from
 * Electron. The shell stays thin and swappable, so if the memory cost of many
 * always-on sessions ever bites, moving to Tauri is a shell swap rather than a
 * rewrite.
 *
 * Promised in the spec and in the README, so it is checked rather than trusted.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CORE = path.join(ROOT, "core");
const FORBIDDEN = [/from\s+["']electron["']/, /require\(\s*["']electron["']\s*\)/, /import\s*\(\s*["']electron["']\s*\)/];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(mjs|js|ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(CORE)) {
  const src = fs.readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (line.trim().startsWith("*") || line.trim().startsWith("//")) return; // a comment may name it
    if (FORBIDDEN.some((re) => re.test(line))) offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error("core/ must not import Electron. The shell is swappable only while this holds.\n");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log(`core purity ok — ${walk(CORE).length} files, zero Electron imports`);
