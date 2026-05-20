# Desktop App — CLAUDE.md

## 60-Second Briefing

- **Identity:** Electron desktop app that automates job applications via Chrome DevTools Protocol. A **dumb terminal** — zero business logic, zero direct Supabase, zero Realtime.
- **Stack:** Electron + TypeScript + React renderer (Vite HMR). Single BrowserWindow with a floating sidebar + adaptive action bar over flush-white middle panel.
- **Role:** Layer 1 shell. All intelligence lives in `web-api/` (Python brain). The embedded `web-app` renders inside BrowserView as Layer 2 (peer app). Communication is a SINGLE WebSocket — CDP, navigate, file sync, panel switch, and pubsub data all ride it.
- **Critical contract:** `MAX_BROWSER_JOB_SESSIONS` here MUST equal `MAX_CONCURRENT_BROWSER_JOBS` in `web-api/finbroapi/src/browser_worker/main.py` (see `workstreams/browser/contracts.md` C9).
- **Next read:** `workstreams/browser/` (workstream.md → architecture.md → handoff.md). This file is the visual-language + source-structure reference; full system architecture lives in the workstream.

---

## Branch Policy

Work on `main` only. No feature branches. Commits land directly on `main`
with clear per-change messages and are pushed immediately. See the
org-wide rule in `jorb.ai/CLAUDE.md`.

## What This Is

Electron desktop app that automates job applications via Chrome DevTools
Protocol (CDP). The app is a **dumb terminal** — zero business logic,
zero direct Supabase access, zero Supabase Realtime. All intelligence
lives in `web-api/`. The shell executes CDP commands, renders the
browser, and streams activity over a single WebSocket.

For the full system architecture, read
`jorb.ai/workstreams/browser/`:

- `workstream.md` — entry point + current invariants
- `architecture.md` — system architecture
- `files.md` — exhaustive file map across all three repos
- `contracts.md` — cross-repo couplings (read before any cross-repo edit)
- `qa.md` — architectural decisions + rationale

## Architecture (Phase 5.2 — white-on-white, JorbHeader, gleam-sweep)

One BrowserWindow with a floating sidebar over a flush middle. The
sidebar is a 180px frosted-glass card; the middle panel is full-bleed
white; the window canvas is solid white so the surface reads as one
continuous space. The action bar above the browser is HIDDEN on idle
and on system tabs (the BrowserView reflows to the top of the middle
panel); it appears only when an agent session is the active tab, and
when expanded it renders the JorbHeader (mascot video + speech bubble).

Dimensions:

- Window background = solid white (#FFFFFF)
- LEFT sidebar zone = **190px** (180px frosted-glass card + 6px L/T/B gutter + 4px R gutter, 14px radius, `backdrop-filter: blur(24px) saturate(180%)`, `rgba(255,255,255,0.72)` fill, elevated drop shadow + 1px subtle border for white-on-white separation)
- Middle action bar = **0 hidden / 96 JorbHeader** (variable)
- Browser area fills the rest

```
┌─── window (white) ────────────────────────────────────────────────────┐
│ ┌──────────┐                                                          │
│ │          │  ┌── Action Bar (0 or 96 JorbHeader) ───────────────┐│
│ │ jorb.ai  │  ├──────────────────────────────────────────────────────┤│
│ │          │  │                                                      ││
│ │ Sessions │  │              BROWSER (flex fills)                    ││
│ │ (WS pub) │  │       viewA (portal) / viewB (tailor)                ││
│ │ ⌁ run    │  │                                                      ││
│ └──────────┘  └──────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────┘
```

`⌁` = subtle gleaming-purple sweep on a running session row (CSS-only,
animation: gleam-sweep, 2.4s loop, signals "agent is working here").

Action-bar state machine (binary: hidden, or the 96px JorbHeader):

| Active tab | Height | Content |
|---|---|---|
| idle / `__webapp__` / `__gmail__` / `__outlook__` | **0** | Hidden; BrowserView fills the middle panel top-to-bottom. |
| any agent session (`queued` / `running` / `needs_review` / `completed` / `failed` / `stopped`) | **96** | JorbHeader: 60px mascot video + speech bubble. Only the speech line changes per state; the bubble is one constant purple, the bar never changes shape or color. Stop button only while `running` / `needs_review`. |

Renderer notifies main of the current bar height via
`window.Finbro.panel.setBarHeight(h)` (0 or 96); `windows.ts`'s
`setActionBarHeight` re-flows `BrowserView` bounds whenever the bar
shows or hides.

**Active-session sync.** Worker-driven navigates load in the
background — `executeNavigate` passes `autoShow: false` to
`navigateSession`, so viewA is created, the URL loads, CDP attaches,
but the view is NOT brought to the front. The browser-tab analogy:
the worker opens a new tab behind your current one, and the sidebar
row's purple gleam (via the `browser_job_inserted` pubsub push) is the
"loading in the background" signal. `panels.ts:showSession` still fires
`session:active-changed` over IPC, but only on user-initiated calls
(sidebar row click, system-tab nav); the renderer's
`window.Finbro.session.onActiveChanged(cb)` listener keeps `activeJobId`
in lockstep with whichever view is actually on top.

## Visual Language

Mirrors the `web-app` webapp's look-and-feel so the desktop shell and
the webapp that runs inside its BrowserViews feel like one product.

- **Typography**: system font stack
  (`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif`) —
  same as `web-app/tailwind.config.ts`. No web fonts, no Google Fonts
  CDN.
- **Color**: single-accent system. `primary` = #290E99 (`finbro-purple`
  in the webapp) reserved for "act now" signals: the agent-live dot,
  the gleaming sweep on running session rows, and the JorbHeader
  speech bubble. NOT used for plain active-row state. Neutrals are a
  Tailwind-aligned gray scale (`gray-50`…`gray-900`) matching
  `web-app`'s actual usage. Semantic `success` / `warning` / `danger`
  carry the session-row status signals: a green pulse (completed), an
  amber pulse (needs-attention), a static red tint (failed), plus small
  marks and icons.
- **Chrome (Phase 5.2)**: solid white window canvas. The sidebar is a
  frosted-glass card (`rgba(255,255,255,0.72)` over `backdrop-filter:
  blur(24px) saturate(180%)`) with an inset white-highlight + an
  elevated drop shadow + a soft 1px border so it reads as a floating
  object on white rather than a contrasting zone. Tight gutter
  (6px L/T/B + 4px R) — almost no gray space. Middle panel is
  full-bleed white. Interactive rows use `rounded-md` (6px) and 28px
  height for compact density.
- **Active state**: subtle pill — `gray-100` fill + 1px `gray-200`
  inset ring + `font-medium` + `gray-900` text. Hover is `gray-50`
  fill. The two states share a fill family so hover feels like a
  precursor to active, not a competing treatment.
- **Running state (Phase 5.2)**: gleaming sweep — a translucent primary
  gradient swept L→R over the row at ~2.4s ease-in-out infinite. Layers
  on top of the active pill if the row is also active. Runs through the
  tailoring sub-flow too; stops only on a terminal status.
- **Brand**: `logo_wordmark.png` image asset in the sidebar header
  (48px container, logo 20px tall). No border-bottom — breathing space
  below carries the separation.
- **Motion**: breathe, not flash. Live dot pulses at ~1.8s. JorbHeader
  speech bubble re-fires `animate-jorb-enter` (0.35s fade-up) on each
  new agent message; ambient halo runs `animate-jorb-glow` (3.5s
  ease-in-out infinite) while running. No typewriter, no spinners.

## Browser Parity

The shell is a browser at heart — tabs, switching, loading, closing. For
any behavior it shares with a real browser, match the browser convention.
Users arrive with deep Chrome/Safari muscle memory; honour it, never fight it.

- Switching tabs is a z-order change — instant, never a reload. The tab
  keeps its scroll, sign-in, and form state (`showOrNavigateSession`).
- A tab loads once, on first open; after that it persists.
- Closing a tab is immediate and irreversible, and the close affordance is
  always reachable — every tab, every state.
- A tab that is loading, or that failed to load, says so — never a blank
  or a stale page.

Not a goal to become a general-purpose browser (no address bar, no
bookmarks — the app doesn't need them). A constraint: for the browser-like
things the shell does do, do them the browser way.

## JorbHeader

The action-bar narrative element when an agent session is running. Ported
from `web-app/src/components/ui/agent/JorbHeader.tsx` to
`src/renderer/components/JorbHeader.tsx` as plain React + plain CSS
(no Tailwind).

- 60×60px mascot video on the left, alpha-keyed via the global
  `<filter id="jorb-alpha">` declared in `index.html` (luma-weighted
  `feColorMatrix` keys out the video's near-black background).
- Speech bubble on the right — primary-tinted background, primary-tinted
  border, "Jorb" eyebrow + the latest agent message body.
- 8 mascot videos in `src/renderer/assets/videos/jorb1.webm` …
  `jorb8.webm`. Picker reshuffles a deck so consecutive plays don't
  repeat. Hover plays the picked video once.
- Wired off the active job's events: speech derives from the latest
  `tool_call`'s human-readable mapping (`config.py:TOOL_NAME_MAPPING`),
  the latest `status` / `paused_for_tailor` / `error` message, or a
  default greeting on cold start.

All tokens live in `src/renderer/lib/colors.ts` with CSS-variable mirrors
in `src/renderer/styles.css`. No product-specific names (no "brand",
no "finbroPurple") — generic names only.

## Source Structure

```
src/
├── main/                        # Electron main process
│   ├── main.ts                  # App lifecycle + macOS re-activate hook
│   ├── logger.ts                # electron-log setup (import from here)
│   ├── config.ts                # electron-store config
│   ├── windows.ts               # Two-panel bounds. setActionBarHeight(h)
│   │                            # re-flows BrowserView bounds when the
│   │                            # renderer bar toggles between 0 and 96.
│   ├── panels.ts                # Multi-session BrowserView manager.
│   │                            # Phase 5.2: showSession fires
│   │                            # session:active-changed IPC.
│   ├── websocket-client.ts      # Single WS. CDP, navigate, file sync,
│   │                            # file_sync_trigger, panel_switch,
│   │                            # queue+flush, auto-resubscribe.
│   ├── auth.ts                  # JWT in-memory. Push-only ingress from
│   │                            # webapp via window.finbro.sendAuthToken.
│   ├── file-sync.ts             # Supabase storage → local files.
│   │                            # file_sync_ack per download + immediate
│   │                            # ack for already-local files.
│   ├── ipc.ts                   # IPC handlers: config, auth, panel
│   │                            # navigate / set-bar-height, browser:stop,
│   │                            # session show / show-tailor / destroy /
│   │                            # status. Phase 5.2: registers
│   │                            # session:active-changed channel name.
│   └── rpc-bridge.ts            # Renderer rpc.ts ↔ WS bridge with
│                                # inbound (3 types) and outbound
│                                # (6 push events + error) allowlists.
│
├── preload/
│   ├── preload.ts               # window.Finbro for the main renderer
│   └── preload-webview.ts       # window.finbro.sendAuthToken for
│                                # BrowserView auth push
│
├── renderer/                    # Main React app
│   ├── app/
│   │   ├── App.tsx              # Two-panel shell. Tracks activeJobId
│   │   │                        # (agent session) vs activeNavId (system
│   │   │                        # tab) as mutually exclusive. Phase 5.2:
│   │   │                        # listens to session.onActiveChanged.
│   │   ├── index.tsx            # ReactDOM entry
│   │   └── index.html           # CSP: default-src + connect-src 'self'
│   │                            # + ws://localhost:5273 http://localhost:5273
│   │                            # for Vite HMR. media-src 'self' for
│   │                            # JorbHeader videos. Global SVG
│   │                            # <filter id="jorb-alpha"> definition.
│   ├── panels/
│   │   ├── session-list/        # Sidebar
│   │   └── action-bar/          # Adaptive action bar (renders JorbHeader
│   │                            # when expanded)
│   ├── components/              # SessionRow, JorbHeader
│   ├── lib/
│   │   ├── rpc.ts               # WS-backed data layer. UUID correlation,
│   │   │                        # 10s timeout. listBrowserJobs /
│   │   │                        # subscribeBrowserJobs / watchAgentJob.
│   │   └── colors.ts            # Design tokens (generic names)
│   ├── assets/                  # logos/ + videos/jorb1..8.webm (Phase 5.2
│   │                            # JorbHeader mascot videos)
│   ├── types.ts                 # BrowserJobRow, BrowserEvent,
│   │                            # SessionDisplayStatus, Window.Finbro decl
│   └── styles.css               # Full design system in CSS variables
│
└── types/                       # Shared types (main + preload)
    ├── config.types.ts          # AppConfig: { debugMode, automationServerUrl }
    └── ipc.types.ts             # IpcChannel enum (PANEL_SET_BAR_HEIGHT;
                                 # Phase 5.2 SESSION_ACTIVE_CHANGED)
```

**Deleted in Phase 5**: `panels/chat-feed/` (entire directory),
`components/AgentStep.tsx`, `components/TailorThread.tsx`,
`components/StreamingDots.tsx`. `src/renderer/lib/supabase.ts` was
deleted in Phase 4 Spec 4.6. Also removed in Phase 5:
`panel.resize` IPC + preload surface, the right-panel width state in
`windows.ts`, and the resize-handle JSX in `App.tsx`.

**Removed in Phase 5.2**: from `panels/action-bar/ActionBar.tsx`:
the 3-line streaming strip (`deriveTrail`, the trail row JSX), the
elapsed counter (`formatElapsed`, `ELAPSED_VISIBLE_MS`), the
"Deciding next step" thinking state (`THINKING_THRESHOLD_MS`,
`thinking-dot` keyframe + JSX), and the breadcrumb-only collapsed
mode for system tabs (now hidden — bar height 0).

**Removed in Phase 6**: the entire 44px collapsed action bar:
`CollapsedBar` and its title breadcrumb, the `--bar-collapsed` CSS var,
and the `.action-bar__collapsed` / `__breadcrumb` / `__sep` / `__status-text`
rules. Every agent-session state now renders the 96px JorbHeader, so the
bar is binary (0 or 96); `deriveMode` derives from the shared
`deriveDisplayStatus`. The `tailor_ready` event keys the amber
needs-attention state (`contracts.md` C10).

## Key Conventions

- **panels/** = layout regions composed once in App.tsx. Never reused.
- **components/** = shared primitives used across panels. Must be generic.
- Panel-specific sub-components live inside their panel folder.
- If a sub-component is used by 2+ panels, promote it to components/.

## Logging

Main process uses `electron-log`. Renderer keeps `console.*` (DevTools only).

```ts
import log from './logger';

log.debug('[Module] ...');  // suppressed in production
log.info('[Module] ...');   // operational milestones
log.warn('[Module] ...');   // unexpected but non-fatal
log.error('[Module] ...');  // failures
```

Rules:
- Every log message starts with `[ModuleName]` bracket prefix.
- No emoji in log messages.
- No raw `console.*` in main process code.
- `debug` = high-volume diagnostics (per-file downloads, CDP nav, signed URLs).
- `info` = operational milestones (startup, connection, sync complete).
- Default level: `info` in production, `debug` when `config.debugMode` is true.
- Log files: `~/Library/Logs/Jorb AI/main.log` (macOS).

## Communication

Single WebSocket is the ONE data channel between this shell and `web-api`.
Everything — CDP, navigate, file upload, file sync, panel_switch, and
pubsub live data — rides on that connection.

| Channel | What Flows | Direction |
|---------|-----------|-----------|
| WebSocket (single) | CDP, navigate, file upload/sync, panel_switch, data-plane pubsub | Main ↔ web-api |
| IPC | Panel nav, `panel:set-bar-height`, auth tokens, `browser:stop`, `session:*`, `rpc:*` | Renderer ↔ Main |
| `window.Finbro` | Preload bridge for main renderer | Main ↔ Renderer |
| `window.finbro` | Auth token push from webapp (in BrowserView) | BrowserView → Main |

**Supabase Realtime is NOT used by this renderer.** All data (list + live
updates for `browser_jobs` and `agent_jobs`) flows over the WS via
`rpc-bridge.ts` + `rpc.ts`. See `workstreams/browser/qa.md` R22 for why.

## Rules

1. No business logic in this shell. It's a dumb terminal.
2. WebSocket is the single data channel. No parallel Supabase client,
   no Supabase Realtime, no other external network surface.
3. Do not inject DOM into any BrowserView. CDP isolation for viewA
   must be preserved.
4. Do not import `@supabase/supabase-js` in the renderer. Enforced by
   `package.json` (no dep) and by CSP `connect-src 'self'`.
5. BrowserView partition is `persist:portal` — isolates cookies from the
   main renderer process.
6. `MAX_BROWSER_JOB_SESSIONS = 5` must equal `MAX_CONCURRENT_BROWSER_JOBS`
   in `web-api/finbroapi/src/browser_worker/main.py`
   (see `workstreams/browser/contracts.md` C9).
7. Do not reintroduce a right panel. Phase 5 was a deliberate removal —
   intervention signals live in the action-bar transform, and the
   Approve affordance lives inside the tailor page per QA R26.
8. Do not name colors after products ("brand", "finbroPurple"). Generic
   tokens only (`primary`, `neutral*`, `success` / `warning` / `danger`).

## Development

```bash
npm install
npm run dev        # Vite dev server (HMR for renderer) + Electron pointing at it.
                   # Renderer changes (CSS, .tsx) update instantly with no restart.
                   # Main-process changes still require kill-and-rerun.
npm run build      # Production build (tsc main + vite build renderer)
npm run build:once # One-shot build + launch Electron (the old `dev` behavior)
npm run package    # Build + package (no distribute)
npm run dist       # Build + distribute (.dmg/.exe)
```

### How the dev loop is wired

`vite.config.ts` runs the dev server on port 5273 (strict). `windows.ts`
checks for `VITE_DEV_SERVER_URL` and, if set, calls `loadURL` against
the dev server instead of `loadFile` against the built `dist/renderer/`.
The `dev` script uses `concurrently` to run Vite + Electron in the same
terminal, with `wait-on tcp:5273` so Electron only launches once Vite is
ready. Closing the Electron window kills the whole script (`--kill-others`).

CSS is imported as a module from `index.tsx` (`import '../styles.css'`),
which is what enables Vite's HMR for stylesheet changes — edits to
`styles.css` apply without a page reload. The `<link>` tag was dropped.

The CSP in `index.html` has `ws://localhost:5273 http://localhost:5273`
in `connect-src` so Vite's HMR WebSocket can connect during dev. These
hosts are local-only so the production build inheriting them is harmless.
