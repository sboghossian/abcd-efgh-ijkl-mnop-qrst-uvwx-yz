import { useEffect } from "react";
import { useStore, hasLive, liveMeta } from "../lib/store";
import type { SurfaceId } from "../lib/types";
import {
  IconHome, IconColumns, IconBoard, IconBrain, IconSystem, IconChart,
  IconGear, IconBook, IconPlus, IconPower, IconMoon, IconSend,
} from "./icons";
import { PromptBox } from "./PromptBox";
import { Toasts } from "./Toasts";
import { Palette } from "./Palette";
import { NewSessionModal, WindDownModal, DayPromptModal } from "./Modals";
import { Home } from "../surfaces/Home";
import { Groups } from "../surfaces/Groups";
import { Kanban } from "../surfaces/Kanban";
import { Brain } from "../surfaces/Brain";
import { SystemCanvas } from "../surfaces/System";
import { Dashboard } from "../surfaces/Dashboard";
import { Settings } from "../surfaces/Settings";
import { Docs } from "../surfaces/Docs";
import { Runs } from "../surfaces/Runs";
import { Day } from "../surfaces/Day";

const NAV: { id: SurfaceId; label: string; icon: () => JSX.Element; key: string }[] = [
  { id: "home", label: "Home", icon: IconHome, key: "1" },
  { id: "groups", label: "Groups", icon: IconColumns, key: "2" },
  { id: "kanban", label: "Board", icon: IconBoard, key: "3" },
  { id: "brain", label: "Brain", icon: IconBrain, key: "4" },
  { id: "system", label: "System", icon: IconSystem, key: "5" },
  { id: "dashboard", label: "Dashboard", icon: IconChart, key: "6" },
  { id: "settings", label: "Settings", icon: IconGear, key: "7" },
  { id: "docs", label: "Docs", icon: IconBook, key: "8" },
  { id: "runs", label: "Runs", icon: IconPower, key: "9" },
  { id: "day", label: "Day", icon: IconSend, key: "0" },
];

const TITLES: Record<SurfaceId, string> = {
  home: "Home", groups: "Groups", kanban: "Board", brain: "Brain",
  system: "System architecture", dashboard: "Dashboard", settings: "Settings", docs: "Documentation",
  runs: "Runs", day: "Day",
};

function Rail() {
  const { ui, dispatch } = useStore();
  return (
    <nav className="rail" aria-label="Surfaces">
      <div className="rail-brand mono" title="abcd-efgh-ijkl-mnop-qrst-uvwx-yz">ab<br />cd</div>
      <button className="rail-new" onClick={() => dispatch({ type: "newSessionModal", open: true })} title="New session  ⌘N" aria-label="New session">
        <IconPlus />
      </button>
      <div className="rail-items">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = ui.surface === n.id;
          return (
            <button key={n.id} className={`rail-item${active ? " on" : ""}`} aria-current={active ? "page" : undefined}
              title={`${n.label}  ⌘${n.key}`} aria-label={n.label} onClick={() => dispatch({ type: "surface", id: n.id })}>
              <Icon />
            </button>
          );
        })}
      </div>
      <div className="rail-foot">
        <button className="rail-item" title="Wind down the day" aria-label="Wind down the day" onClick={() => dispatch({ type: "windDown", open: true })}>
          <IconPower />
        </button>
        <button className="rail-item" title="Toggle theme" aria-label="Toggle theme" onClick={() => {
          const el = document.documentElement;
          const cur = el.getAttribute("data-theme");
          const isDark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
          el.setAttribute("data-theme", isDark ? "light" : "dark");
        }}>
          <IconMoon />
        </button>
      </div>
    </nav>
  );
}

function TopBar() {
  const { app, ui, dispatch } = useStore();
  const live = app.sessions.filter((s) => s.status === "working").length;
  const blocked = app.sessions.filter((s) => s.status === "needs-input").length;
  return (
    <header className="topbar">
      <div className="topbar-l">
        <span className="topbar-title">{TITLES[ui.surface]}</span>
        <button className="objective" onClick={() => dispatch({ type: "dayPrompt", open: true })} title="Edit today's objective">
          <span className="eyebrow">Today</span>
          <span className="objective-text">{app.today.text}</span>
        </button>
      </div>
      <div className="topbar-r mono">
        <div className="srctog" role="group" aria-label="Data source">
          {ui.coreMeta && (
            <button className={ui.source === "core" ? "on" : ""} onClick={() => dispatch({ type: "source", source: "core" })}
              title={`Live from the core server · ${ui.coreMeta.sessionsRead} of ${ui.coreMeta.transcriptsOnDisk} transcripts · ${ui.coreMeta.liveProcesses} running now`}>
              Core
            </button>
          )}
          {hasLive && (
            <button className={ui.source === "live" ? "on" : ""} onClick={() => dispatch({ type: "source", source: "live" })}
              title={liveMeta ? `Snapshot · ${liveMeta.sessionsRead} sessions` : "Local snapshot"}>Snapshot</button>
          )}
          <button className={ui.source === "demo" ? "on" : ""} onClick={() => dispatch({ type: "source", source: "demo" })}
            title="Synthetic data — what the public repo ships">Demo</button>
        </div>
        {ui.coreMeta && (
          <span className="idxpill" title={`Index holds ${ui.coreMeta.index.days} days: ${ui.coreMeta.index.daysFromIndex} observed by abcd, ${ui.coreMeta.index.daysFromVault} recovered from the vault. Oldest ${ui.coreMeta.index.oldestDay ?? "n/a"}.`}>
            {ui.coreMeta.index.days}d indexed
          </span>
        )}
        <span className="stat"><span className="dot s-working" /> {live} working</span>
        <span className="stat"><span className="dot s-needs-input" /> {blocked} blocked</span>
        <button className="kbd" onClick={() => dispatch({ type: "palette", open: true })}>⌘K</button>
      </div>
    </header>
  );
}

export function App() {
  const { ui, dispatch } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); dispatch({ type: "palette", open: !ui.paletteOpen }); return; }
      if (meta && e.key.toLowerCase() === "n") { e.preventDefault(); dispatch({ type: "newSessionModal", open: true }); return; }
      if (e.key === "Escape") {
        dispatch({ type: "palette", open: false });
        dispatch({ type: "newSessionModal", open: false });
        dispatch({ type: "windDown", open: false });
        dispatch({ type: "dayPrompt", open: false });
        if (ui.focusMode) dispatch({ type: "focus", on: false });
        return;
      }
      if (meta && /^[0-9]$/.test(e.key)) {
        const hit = NAV.find((n) => n.key === e.key);
        if (hit) { e.preventDefault(); dispatch({ type: "surface", id: hit.id }); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.paletteOpen, ui.focusMode, dispatch]);

  return (
    <div className="app">
      <Rail />
      <div className="main">
        <TopBar />
        <div className="surface scroll">
          {ui.surface === "home" && <Home />}
          {ui.surface === "groups" && <Groups />}
          {ui.surface === "kanban" && <Kanban />}
          {ui.surface === "brain" && <Brain />}
          {ui.surface === "system" && <SystemCanvas />}
          {ui.surface === "dashboard" && <Dashboard />}
          {ui.surface === "settings" && <Settings />}
          {ui.surface === "docs" && <Docs />}
          {ui.surface === "runs" && <Runs />}
          {ui.surface === "day" && <Day />}
        </div>
        <PromptBox />
      </div>
      <Toasts />
      {ui.paletteOpen && <Palette />}
      {ui.newSessionOpen && <NewSessionModal />}
      {ui.windDownOpen && <WindDownModal />}
      {ui.dayPromptOpen && <DayPromptModal />}
    </div>
  );
}
