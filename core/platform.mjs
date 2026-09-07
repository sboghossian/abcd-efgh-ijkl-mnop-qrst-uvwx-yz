/**
 * PlatformAdapter — decision 18 ships three platforms, in sequence.
 *
 * Four things are macOS-shaped and each needs an implementation per platform.
 * The interfaces land now because retrofitting them is expensive; the
 * platforms ship in order, because one person cannot QA three at once and a
 * broken Windows build damages the project more than an absent one.
 *
 * Every method reports `supported` rather than throwing, so the UI can show a
 * capability as unavailable instead of failing at the moment someone uses it.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const PLATFORM = process.platform; // "darwin" | "linux" | "win32"

const NOT_SUPPORTED = (what) => ({ supported: false, reason: `${what} is not implemented for ${PLATFORM} yet` });

/* ---------------- 1. session socket ---------------- */
/**
 * macOS and Linux use a Unix domain socket; native Windows uses a named pipe.
 * A WSL2 session and a native Windows session cannot see each other at all —
 * different home directories, different socket types — so abcd must not claim
 * cross-visibility there.
 */
function socketSupport() {
  switch (PLATFORM) {
    case "darwin":
    case "linux":
      return { supported: true, kind: "unix", note: PLATFORM === "linux" ? "WSL2 sessions cannot see native Windows sessions" : null };
    case "win32":
      return { supported: true, kind: "named-pipe", note: "an auth line is REQUIRED on native Windows, unlike macOS and Linux" };
    default:
      return NOT_SUPPORTED("the session socket");
  }
}

/* ---------------- 2. scheduled routines ---------------- */
function schedulerSupport() {
  switch (PLATFORM) {
    case "darwin": return { supported: true, kind: "launchd", dir: path.join(os.homedir(), "Library/LaunchAgents") };
    case "linux": return { supported: true, kind: "systemd", dir: path.join(os.homedir(), ".config/systemd/user") };
    case "win32": return { supported: true, kind: "schtasks", dir: null };
    default: return NOT_SUPPORTED("scheduled routines");
  }
}

/**
 * Reading existing routines is safe everywhere; abcd does not create them.
 * Returns [] rather than throwing when the directory is absent.
 */
export function listScheduled() {
  const s = schedulerSupport();
  if (!s.supported || !s.dir) return { ...s, entries: [] };
  try {
    const entries = fs.readdirSync(s.dir)
      .filter((f) => f.endsWith(".plist") || f.endsWith(".service") || f.endsWith(".timer"))
      .slice(0, 200);
    return { ...s, entries };
  } catch { return { ...s, entries: [] }; }
}

/* ---------------- 3. keep-awake ---------------- */
/**
 * Stops a closed laptop stranding running agents. Costs battery, so it is
 * opt-in and abcd says so. Returns the COMMAND rather than running it: the
 * caller decides, and the audit log records the decision.
 */
export function keepAwakeCommand() {
  switch (PLATFORM) {
    case "darwin": return { supported: true, cmd: "caffeinate", args: ["-dimsu"] };
    case "linux": return { supported: true, cmd: "systemd-inhibit", args: ["--what=idle:sleep", "--why=abcd keep-awake", "sleep", "infinity"] };
    case "win32": return { supported: false, reason: "needs SetThreadExecutionState via a native binding; not implemented" };
    default: return NOT_SUPPORTED("keep-awake");
  }
}

/* ---------------- 4. vault candidates ---------------- */
export function vaultCandidates() {
  const home = os.homedir();
  const common = [path.join(home, "Obsidian"), path.join(home, "vault"), path.join(home, "Documents/Obsidian")];
  switch (PLATFORM) {
    case "darwin":
      return [...common, path.join(home, "Library/Mobile Documents/iCloud~md~obsidian/Documents")];
    case "linux": {
      const xdg = process.env.XDG_DOCUMENTS_DIR;
      return [...common, ...(xdg ? [path.join(xdg, "Obsidian")] : [])];
    }
    case "win32": {
      const profile = process.env.USERPROFILE || home;
      return [path.join(profile, "Obsidian"), path.join(profile, "Documents", "Obsidian"), ...common];
    }
    default: return common;
  }
}

/* ---------------- 5. signing, for the record ---------------- */
/**
 * Not a runtime concern, but stated here so the packaging story is visible
 * from the code rather than only from a README.
 */
export function signingRequirement() {
  switch (PLATFORM) {
    case "darwin": return { required: true, kind: "Apple notarisation", needs: "a paid Apple Developer account and a Developer ID Application certificate" };
    case "win32": return { required: true, kind: "Authenticode", needs: "a code-signing certificate from a recognised CA" };
    case "linux": return { required: false, kind: "none", needs: "an unsigned AppImage is acceptable" };
    default: return { required: false, kind: "unknown", needs: null };
  }
}

export function describePlatform() {
  return {
    platform: PLATFORM,
    arch: process.arch,
    release: os.release(),
    /** macOS first, then Linux, then Windows. Decision 18. */
    tier: PLATFORM === "darwin" ? "primary" : PLATFORM === "linux" ? "secondary" : "untested",
    socket: socketSupport(),
    scheduler: schedulerSupport(),
    keepAwake: keepAwakeCommand(),
    vaultCandidates: vaultCandidates(),
    signing: signingRequirement(),
  };
}
