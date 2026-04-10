# Desktop App — CLAUDE.md

## What This Is

Electron desktop app that automates job applications via Chrome DevTools Protocol (CDP). The app is a **dumb terminal** — all intelligence lives in the API (`web-api/`). The app executes CDP commands, renders the browser, and streams activity from Supabase Realtime.

## Architecture

Three-panel layout: left (sessions), middle (BrowserView + action bar), right (activity feed).

```
┌──────────────┬──────────────────────────────────┬──────────────────────┐
│  LEFT 190px  │         MIDDLE (flex: 1)          │   RIGHT 220px        │
│              │  ┌───────────────────────────────┐│                      │
│  Sessions    │  │  Action Bar (42px)            ││  Activity Feed       │
│  (Realtime)  │  │  Status | [Stop]              ││  (Realtime)          │
│              │  └───────────────────────────────┘│                      │
│              │  ┌───────────────────────────────┐│                      │
│              │  │  BrowserView (CDP-attached)   ││                      │
│              │  │  Portal session partition     ││                      │
│              │  └───────────────────────────────┘│                      │
└──────────────┴──────────────────────────────────┴──────────────────────┘
```

## Source Structure

```
src/
├── main/                        # Electron main process
│   ├── main.ts                  # App lifecycle
│   ├── logger.ts                # electron-log setup (import from here, not electron-log directly)
│   ├── config.ts                # electron-store config
│   ├── windows.ts               # Window creation, panel layout
│   ├── panels.ts                # BrowserView management + CDP debugger
│   ├── websocket-client.ts      # WS to API (CDP commands, navigate, file upload)
│   ├── auth.ts                  # JWT management, renderer notification
│   ├── file-sync.ts             # Supabase storage → local file sync
│   └── ipc.ts                   # IPC handlers
│
├── preload/
│   ├── preload.ts               # Main renderer bridge (window.Finbro)
│   └── preload-webview.ts       # BrowserView bridge (auth token push only)
│
├── renderer/
│   ├── app/                     # Entry point + shell
│   │   ├── App.tsx              # Three-panel layout
│   │   ├── index.tsx            # ReactDOM entry
│   │   └── index.html           # HTML shell + CSP
│   ├── panels/                  # Top-level layout regions (not reusable)
│   │   ├── session-list/        # Left panel
│   │   ├── action-bar/          # Middle panel top strip
│   │   └── chat-feed/           # Right panel
│   ├── components/              # Shared reusable primitives (Button, Skeleton, etc.)
│   ├── hooks/                   # Shared React hooks
│   ├── lib/                     # Non-React logic (Supabase client)
│   ├── assets/                  # Logos, SVGs, icons
│   ├── types.ts                 # Shared TypeScript types
│   └── styles.css               # Global styles + CSS vars
│
└── types/                       # Shared types (main + preload)
    ├── config.types.ts
    └── ipc.types.ts
```

## Key Conventions

- **panels/** = layout regions composed once in App.tsx. Never reused.
- **components/** = shared primitives used across panels. Must be generic.
- Panel-specific sub-components live inside their panel folder, not in components/.
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
- `debug` = high-volume diagnostics (per-file downloads, CDP nav, signed URLs, path details).
- `info` = operational milestones (startup, connection, sync complete).
- Default level: `info` in production, `debug` when `config.debugMode` is true.
- Log files: `~/Library/Logs/Jorb AI/main.log` (macOS).

## Communication

| Channel | What Flows | Direction |
|---------|-----------|-----------|
| WebSocket | CDP commands, navigate, file upload/sync | API ↔ Electron |
| Supabase Realtime | Job status, events, activity stream | API → Electron |
| IPC | Panel navigation, auth tokens, stop signals | Renderer → Main |
| `window.Finbro` | Preload bridge for renderer | Main ↔ Renderer |
| `window.finbro` | Auth token push from web app in BrowserView | BrowserView → Main |

## Rules

1. No business logic in the Electron app. It's a dumb terminal.
2. WebSocket is for CDP commands and navigation only. Data flows through Supabase Realtime.
3. Do not inject DOM into the BrowserView. CDP isolation must be preserved.
4. BrowserView uses a separate session partition (`persist:portal`) to isolate cookies from the web app.

## Development

```bash
npm install
npm run dev        # Build + launch Electron
npm run build      # Build only (tsc + vite)
npm run package    # Build + package (no distribute)
npm run dist       # Build + distribute (.dmg/.exe)
```
