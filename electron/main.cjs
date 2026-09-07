/**
 * abcd desktop shell. CommonJS on purpose: Electron's own module is CJS and
 * the ESM interop in its bundled Node fails on it, so the entry point is the
 * one file in the repo that is not ESM.
 *
 * Deliberately thin, and `core/` runs as a SIDECAR rather than in-process.
 *
 * That is not tidiness. Electron bundles its own Node — Electron 33 ships Node
 * 20.18 — and the history index uses `node:sqlite`, which needs Node 22.5+.
 * Mounting core inside the shell would couple the index to whichever Node the
 * shell happens to ship, and re-couple it on every Electron upgrade. Running
 * core as its own process decouples them entirely, keeps a core crash from
 * taking the window down, and makes the Tauri exit the spec promised a literal
 * shell swap rather than a rewrite.
 *
 * The cost, stated honestly: abcd needs a Node 22.5+ on PATH. It already needs
 * the `claude` CLI, so this is not a new class of dependency — but it is one,
 * and the shell says so plainly instead of failing obscurely.
 */
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require("electron");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");

/**
 * When packaged, `electron/` lives inside app.asar but the sidecar cannot be
 * spawned from an archive, so `server.mjs` and `core/` are asarUnpack'd and
 * resolved from app.asar.unpacked instead. This only fails in a packaged
 * build, which is why the packaged build gets run rather than assumed.
 */
const ROOT = path.join(__dirname, "..");
const SIDECAR_ROOT = ROOT.includes(`${path.sep}app.asar${path.sep}`) || ROOT.endsWith(`${path.sep}app.asar`)
  ? ROOT.replace(`${path.sep}app.asar`, `${path.sep}app.asar.unpacked`)
  : ROOT;
const isDev = !app.isPackaged;
const DEV_URL = process.env.ABCD_DEV_URL || "http://localhost:4488";
const CORE_PORT = Number(process.env.ABCD_PORT || 4499);
const MIN_NODE = [22, 5];

let win = null;
let tray = null;
let coreProc = null;
let keepAwakeProc = null;
let quitting = false;

/* ---------------- the sidecar's one dependency ---------------- */

function findNode() {
  const candidates = [
    process.env.ABCD_NODE,
    ...String(process.env.PATH || "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, "node")),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      const v = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 4000 }).trim();
      const m = v.match(/^v(\d+)\.(\d+)/);
      if (!m) continue;
      const major = Number(m[1]); const minor = Number(m[2]);
      const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
      if (ok) return { bin, version: v };
    } catch { /* next candidate */ }
  }
  return null;
}

const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});

async function startCore() {
  if (!(await portFree(CORE_PORT))) {
    // Reuse an already-running core rather than fighting it for the port.
    return { reused: true, port: CORE_PORT };
  }
  const node = findNode();
  if (!node) {
    dialog.showErrorBox(
      "abcd needs Node 22.5 or newer",
      `The history index uses node:sqlite, which arrived in Node 22.5.\n\n`
      + `No suitable node was found on PATH. Install Node 22.5+, or point abcd at one:\n\n`
      + `    ABCD_NODE=/path/to/node\n\n`
      + `abcd will open, but it will show synthetic data until a core is running.`,
    );
    return null;
  }
  const serverPath = path.join(SIDECAR_ROOT, "server.mjs");
  if (!require("node:fs").existsSync(serverPath)) {
    dialog.showErrorBox("abcd could not find its core", `Expected the sidecar at:\n\n${serverPath}\n\nThe build may be missing its asarUnpack entries.`);
    return null;
  }
  coreProc = spawn(node.bin, [serverPath], {
    cwd: SIDECAR_ROOT,
    env: { ...process.env, ABCD_PORT: String(CORE_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  coreProc.stdout.on("data", (d) => process.stdout.write(`[core] ${d}`));
  coreProc.stderr.on("data", (d) => process.stderr.write(`[core] ${d}`));
  coreProc.on("exit", (code) => {
    coreProc = null;
    // A core crash must not take the window with it; the UI degrades to
    // synthetic data and says so, which is what it already does when the
    // server is simply not running.
    if (!quitting && code !== 0) console.error(`[core] exited with ${code}`);
    tray?.setContextMenu(trayMenu());
  });
  return { reused: false, port: CORE_PORT, node: node.version };
}

/* ---------------- keep-awake ---------------- */

function setKeepAwake(on) {
  if (!on) { if (keepAwakeProc) { keepAwakeProc.kill(); keepAwakeProc = null; } return false; }
  if (keepAwakeProc) return true;
  if (process.platform === "win32") return false;
  const spec = process.platform === "darwin"
    ? { cmd: "caffeinate", args: ["-dimsu"] }
    : { cmd: "systemd-inhibit", args: ["--what=idle:sleep", "--why=abcd keep-awake", "sleep", "infinity"] };
  try {
    keepAwakeProc = spawn(spec.cmd, spec.args, { stdio: "ignore" });
    keepAwakeProc.on("exit", () => { keepAwakeProc = null; });
    return true;
  } catch { return false; }
}

/* ---------------- window and tray ---------------- */

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0d1416",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  if (isDev) await win.loadURL(DEV_URL);
  else await win.loadFile(path.join(ROOT, "dist", "index.html"));
  win.on("close", (e) => {
    // Closing the window must not strand running agents, so it hides.
    if (!quitting && process.platform === "darwin") { e.preventDefault(); win?.hide(); }
  });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: "Open abcd", click: () => { win ? win.show() : createWindow(); } },
    { type: "separator" },
    {
      label: "Keep this machine awake", type: "checkbox", checked: Boolean(keepAwakeProc),
      enabled: process.platform !== "win32",
      toolTip: "Stops a closed laptop stranding running agents. Costs battery.",
      click: (item) => { const on = setKeepAwake(item.checked); item.checked = on; tray?.setContextMenu(trayMenu()); },
    },
    { type: "separator" },
    { label: coreProc ? `core running on :${CORE_PORT}` : "core not running — synthetic data", enabled: false },
    { type: "separator" },
    { label: "Quit abcd", click: () => { quitting = true; app.quit(); } },
  ]);
}

app.whenReady().then(async () => {
  const started = await startCore().catch((e) => {
    dialog.showErrorBox("abcd could not start its core", String(e?.message || e));
    return null;
  });
  if (started?.node) console.log(`[abcd] core sidecar on :${started.port} using node ${started.node}`);
  if (started?.reused) console.log(`[abcd] reusing a core already on :${started.port}`);
  await createWindow();
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("abcd");
  tray.setContextMenu(trayMenu());
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else win?.show(); });
});

app.on("before-quit", () => { quitting = true; setKeepAwake(false); coreProc?.kill(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
