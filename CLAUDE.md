# Desktop App — CLAUDE.md

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
`jorb.ai/app/workstreams/browser/`:

- `CLAUDE.md` — entry point + current invariants
- `PLAN.md` — system architecture
- `FILES.md` — exhaustive file map across all three repos
- `CONTRACTS.md` — cross-repo couplings (read before any cross-repo edit)
- `QA.md` — architectural decisions + rationale

## Architecture (Phase 5 — two-panel)

Two-panel layout inside one BrowserWindow. The right chat-feed panel is
gone; all observability + intervention signals live in the adaptive
action bar above the browser area.

Dimensions:

- LEFT sidebar = **200px** (fixed, +11% wider than Phase-4 to mirror finbro.me density)
- Middle action bar = **44px collapsed / 96px expanded** (variable)
- Browser area fills the remaining middle space

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│              │  ┌─────────────────────────────────────────────────────┐  │
│  LEFT 200px  │  │  Action Bar — 44px collapsed / 96px expanded         │  │
│              │  └─────────────────────────────────────────────────────┘  │
│  Sessions    │                                                           │
│  (WS pubsub) │                   BROWSER (flex fills)                    │
│              │            viewA (portal) / viewB (tailor) /              │
│              │            SessionPlaceholder card                        │
│              │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
```

Action-bar state machine (eight states, two heights):

| Active tab | Height | Content |
|---|---|---|
| `__webapp__` / `__gmail__` / `__outlook__` | 44px | Breadcrumb |
| `queued` agent | 44px | Title + "Waiting for worker capacity" |
| `running` agent | 96px | 3-line streaming strip |
| `running` + needs_review | 96px | 3-line strip, primary-accent left rail |
| `completed` / `failed` / `stopped` | 44px | Title + single-line status |

Renderer notifies main of the current bar height via
`window.Finbro.panel.setBarHeight(h)`; `windows.ts`'s `setActionBarHeight`
re-flows `BrowserView` bounds so the browser area stays aligned.

When the active session has no BrowserView attached (queued or
terminal-past-grace), renderer calls `window.Finbro.session.showPlaceholder()`
and `panels.ts` detaches every view so the HTML `SessionPlaceholder`
card becomes visible in the middle panel.

## Visual Language

Mirrors the `finbro.me` webapp's look-and-feel so the desktop shell and
the webapp that runs inside its BrowserViews feel like one product.

- **Typography**: system font stack
  (`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif`) —
  same as `finbro.me/tailwind.config.ts`. No web fonts, no Google Fonts
  CDN, no CSP widening.
- **Color**: single-accent system. `primary` = #290E99 reserved for
  "act now" signals (active-session indicator, needs-attention dot,
  approve state). Neutrals are a Tailwind-aligned gray scale
  (`gray-50`…`gray-900`) matching `finbro.me`'s actual usage. Semantic
  `success` / `warning` / `danger` used only on small marks / icons.
- **Chrome**: pure white surfaces, 1px `gray-300` hairline borders,
  `shadow-sm` on the sidebar, `rounded-lg` (8px) on interactive
  elements — mirrors `finbro.me`'s shadcn-on-Tailwind chrome.
- **Brand**: `logo_wordmark.png` image asset in the sidebar header
  (64px container, logo 32px tall), not a text brand mark. Matches
  `finbro.me/src/components/Logo.tsx`.
- **Motion**: breathe, not flash. Live dot pulses at ~1.8s. Current-action
  line crossfades (200ms). No typewriter, no spinners, no progress bars.

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
│   │                            # renderer bar toggles between 44/96.
│   ├── panels.ts                # Multi-session BrowserView manager.
│   │                            # Phase 5: adds showPlaceholder() which
│   │                            # detaches every view so the HTML
│   │                            # SessionPlaceholder card is visible.
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
│   │                            # session show / show-tailor /
│   │                            # show-placeholder / destroy / status
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
│   │   │                        # tab) as mutually exclusive. 30s grace
│   │   │                        # timer → placeholder-swap on active
│   │   │                        # session's view destruction.
│   │   ├── index.tsx            # ReactDOM entry
│   │   └── index.html           # Strict CSP: default-src + connect-src
│   │                            # 'self', no external hosts. System font
│   │                            # stack via styles.css.
│   ├── panels/
│   │   ├── session-list/        # Sidebar
│   │   └── action-bar/          # Adaptive action bar
│   ├── components/              # SessionRow, SessionPlaceholder
│   ├── lib/
│   │   ├── rpc.ts               # WS-backed data layer. UUID correlation,
│   │   │                        # 10s timeout. listBrowserJobs /
│   │   │                        # subscribeBrowserJobs / watchAgentJob.
│   │   └── colors.ts            # Design tokens (generic names)
│   ├── assets/                  # logo_wordmark.png (rendered in the
│   │                            # sidebar header) and logo_square.png
│   ├── types.ts                 # BrowserJobRow, BrowserEvent,
│   │                            # SessionDisplayStatus, Window.Finbro decl
│   └── styles.css               # Full design system in CSS variables
│
└── types/                       # Shared types (main + preload)
    ├── config.types.ts          # AppConfig: { debugMode, automationServerUrl }
    └── ipc.types.ts             # IpcChannel enum (incl. Phase 5
                                 # SESSION_SHOW_PLACEHOLDER and
                                 # PANEL_SET_BAR_HEIGHT)
```

**Deleted in Phase 5**: `panels/chat-feed/` (entire directory),
`components/AgentStep.tsx`, `components/TailorThread.tsx`,
`components/StreamingDots.tsx`. `src/renderer/lib/supabase.ts` was
deleted in Phase 4 Spec 4.6. Also removed in Phase 5:
`panel.resize` IPC + preload surface, the right-panel width state in
`windows.ts`, and the resize-handle JSX in `App.tsx`.

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
`rpc-bridge.ts` + `rpc.ts`. See `workstreams/browser/QA.md` R22 for why.

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
   (see `workstreams/browser/CONTRACTS.md` C9).
7. Do not reintroduce a right panel. Phase 5 was a deliberate removal —
   intervention signals live in the action-bar transform + sidebar
   accent dot, and the Approve affordance lives inside the tailor page
   per QA R26.
8. Do not name colors after products ("brand", "finbroPurple"). Generic
   tokens only (`primary`, `neutral*`, `success` / `warning` / `danger`).

## Development

```bash
npm install
npm run dev        # Build + launch Electron
npm run build      # Build only (tsc + vite)
npm run package    # Build + package (no distribute)
npm run dist       # Build + distribute (.dmg/.exe)
```
