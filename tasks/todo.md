# abcd — build plan

Spec: `docs/SPEC.html` (living PRD, untracked). 23 decisions locked 2026-09-07, none open.

## Phase 0 — clickable front end (current)

- [x] Repo scaffold, Vite + React 18 + TS strict, node_modules symlinked out of iCloud
- [x] Design system — 4 type roles, accent-as-verb, mono-for-data, full light/dark
- [x] Data model (`src/lib/types.ts`) — pure JSON so mock and app share one renderer
- [x] DEMO=1 synthetic fixtures — no real data, safe for public screenshots
- [x] Shell — 56px rail, top bar, command palette, modals, grouping toast with pinning undo
- [x] Global prompt box — `@` targeting, broadcast, tier-3 unreachable marking, local dictation
- [x] Home — five-range summary that states its own index depth
- [x] Groups — group strip, columns, session tabs, drag between columns, 3 body views
- [x] Kanban — 5 derived-status columns, filters, drag shows the derived-status note
- [x] Brain — lobe view + full vault browser with backlinks
- [x] System — pan/zoom canvas, typed edges, node inspector
- [x] Dashboard — 182-day heatmap, token chart, spend by group, widget catalogue
- [x] Settings — 9 tabs, every control bound to state
- [x] Docs — 8 topics, in-app, doubles as README source
- [x] README + AGPL licence
- [x] Production build green
- [x] QA pass across all 12 surfaces, both themes
- [x] Live snapshot generator (`npm run snapshot`) + LIVE/DEMO toggle
- [x] Public GitHub repo, AGPL-3.0, clean single-commit history
- [x] Grouping corrected: root wins inside a repo, content decides elsewhere (decision 20)
- [ ] Screenshots for README from DEMO=1

## Phase 1 — read-only truth (SHIPPED)

- [x] `core/` — pure Node, zero Electron imports
- [x] Session registry reader + tier derivation with version gating
- [x] Transcript parser — byte-capped, keeps `parentUuid` for Phase 2 replay
- [x] History index (`node:sqlite`, no native dep) — idempotent, index/vault sourced
- [x] Settings / skills / agents / hooks / MCP / plugins readers
- [x] Vault reader — bounded sampling, pre-computed backlinks
- [x] `server.mjs` — 127.0.0.1, GET-only, $HOME jail, audit log
- [x] UI reads core when up; falls back snapshot → demo
- [x] Test suite — 63 tests, `npm test`
- [ ] Watcher for push updates instead of 15s polling
- [ ] Verified-socket-version list needs a real maintenance story; the running
      CLI (2.1.263) already outran the hardcoded array

## Phase 2 — the run engine (SHIPPED)

- [x] `RuntimeAdapter` carrying parseTranscript + deriveStatus (decision 22)
- [x] Claude Code adapter — verified against the live CLI, not the docs
- [x] Tier 1 spawn + stream + bidirectional stdin + interrupt + end
- [x] Permission gate, fail-closed, snapshot + sha256-verified revert
- [x] One gated `POST /api/action` + SSE `/api/events`
- [x] Runs surface: gates first, live output, measured-vs-estimated cost
- [x] Resume and fork exposed as actions and UI, refused by capability
- [x] Nav beyond 10 surfaces: cycle with ⌘[ / ⌘], palette is the real answer
- [x] Codex adapter — built against real transcripts on disk, not documentation.
      Capabilities are DISCOVERED (PATH walk, no shell), so with the binary
      absent it declares "history only" rather than pretending it can spawn.
- [ ] Decide whether abcd-owned runs opt out of user hooks via `--setting-sources`
      (today `--settings` merges, so every user hook runs inside every spawn —
      correct, but it made a trivial run take 35s)

## Phase 3 — reach and the day

- [x] Reach gated on `peerProtocol` + `peerFeatures`, not a CLI version string
      (self-maintaining: the protocol advertises its own version)
- [x] `reachReason()` — every session says WHY it is or is not reachable
- [x] Day loop: open, objective, facts-from-index, close, reconciliation
- [x] Broadcast with per-target outcomes; nothing is ever silently dropped
- [x] Wind-down + resume, cooperative by design
- [x] `/api/day`, `/api/targets`, and the day/broadcast actions
- [x] Day surface: objective, facts-from-index, reconciliation, recent strip,
      reach grouped by tier with reasons verbatim, broadcast with per-target
      outcomes
- [x] **Tier-2 write: closed as unimplementable, not deferred.** Every
      supported interface was checked. SendMessage/ListAgents are internal to
      an agent's tool loop. The peer socket's transport is documented but its
      message schema is not, and it is designed for a session's own children.
      Channels must be opted in AT LAUNCH via `--channels`, so they cannot be
      retrofitted into a running session. abcd therefore detects reach and
      reports it, and routes real work through runs it owns.
- [ ] Note for users: the RECEIVING session governs delivery via
      `crossSessionInbound` (accept / hold / refuse), so abcd must surface that
      rather than claim delivery it cannot guarantee

## Phase 4 — harness surfaces on real data (SHIPPED)

- [x] Every surface already read real data via /api/state
- [x] Settings WRITES: allowlisted keys only, snapshot + sha256 revert, atomic
      temp-file rename, refuses `hooks` outright. Round-trip verified
      byte-identical against the real settings.json
## Phase 5 — packaging (SHIPPED, unsigned)

- [x] Electron shell, CommonJS entry (Electron's module is CJS)
- [x] core/ as a SIDECAR — Electron 33 ships Node 20.18, node:sqlite needs 22.5
- [x] `npm run lint:core` enforces zero Electron imports in core/, and the
      check was proven to fail when violated
- [x] asarUnpack for server.mjs + core/ — a child process cannot be spawned
      from inside app.asar. Only shows up in a packaged build
- [x] DMGs built and the PACKAGED app verified running the real sidecar
- [ ] SIGNING — blocked on an Apple Developer account + Developer ID cert.
      Config and entitlements are in place; run `npm run dist` with
      APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID set
## Phase 6 — Linux, then Windows

- [x] `core/platform.mjs` — socket kind, scheduler, keep-awake, vault
      candidates and signing requirement, per platform. Reports `supported`
      rather than throwing, so the UI shows unavailable instead of failing
- [x] electron-builder targets for AppImage and NSIS
- [ ] UNVERIFIED on Linux and Windows: I have no machine to run them on.
      macOS is `primary`, Linux `secondary`, Windows `untested`, and
      describePlatform() says so rather than implying parity

## Open questions

None. Q1-Q11 answered and folded into decisions 12-23.

## Standing constraints

- Scan before publishing, always. Publishing is the irreversible step.
- `src/fixtures/live.local.ts`, `scripts/*.local.json` and `docs/SPEC.html`
  are gitignored and contain real data. They must never be committed.
- Kill dev servers by port, never by process name — other sessions run too.
