<div align="center">

<img src="src/renderer/assets/logos/logo_wordmark.png" alt="Jorb AI" width="280" />

### Jorb AI Desktop

**Automated job applications, supervised in real time.**

An Electron desktop app where an AI agent fills application forms via Chrome DevTools Protocol — and you watch every keystroke, approve every tailored document, and stop the agent at any step.

[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey)](https://www.electronjs.org/)

[Website](https://jorb.ai) · [Architecture](./CLAUDE.md) · [Issues](https://github.com/jorb-ai/desktop-app/issues)

</div>

---

## What it does

Sign up at [jorb.ai](https://jorb.ai), download the desktop app, and ask Jorb to apply to a job. The agent opens the application page inside the app, reads the form, fills your details, attaches tailored resumes and cover letters, and submits — all while you watch in real time.

Three things make it different from a Playwright script:

- **Chrome DevTools Protocol, not JS injection.** Keystrokes look like human input at the browser-engine level. Job portals' bot detection sees nothing unusual.
- **Live human-in-the-loop.** Every step is visible; you can stop at any moment. Tailored resumes and cover letters require explicit approval before upload.
- **Dumb-terminal architecture.** This app has zero business logic and zero direct database access. All intelligence lives in the backend; the shell only renders, attaches CDP, and ships commands over one WebSocket.

## Stack

- **[Electron 41](https://www.electronjs.org/)** + **[TypeScript 5](https://www.typescriptlang.org/)** — desktop runtime
- **[React 19](https://react.dev/)** + **[Vite 7](https://vitejs.dev/)** — renderer with HMR
- **Chrome DevTools Protocol** — page automation
- **WebSocket** (single connection) — data + control channel to the backend

## Quick start

```bash
git clone https://github.com/jorb-ai/desktop-app.git
cd desktop-app
npm install
npm run dev
```

`npm run dev` boots Vite on `:5273` and launches Electron pointing at it. Renderer changes hot-reload; main-process changes need a restart.

You'll also need the backend running locally — see [`web-api`](https://github.com/jorb-ai/web-api) — and the webapp on `:3000` from [`web-app`](https://github.com/jorb-ai/web-app).

## Build & distribute

```bash
npm run build       # one-shot tsc + vite build
npm run build:once  # build + launch with the production renderer
npm run package     # electron-builder (no distribute)
npm run dist        # electron-builder + .dmg / .zip (macOS) / .exe (Windows)
```

Artifacts land in `release/`.

## Architecture at a glance

```
┌── Main process ────────────┐         ┌── Backend (web-api) ──┐
│ panels.ts (BrowserViews)   │ ←─ WS ─→│ Agent orchestrator    │
│ websocket-client.ts        │         │ Pubsub poll loop      │
│ file-sync.ts               │         │ Service-role Supabase │
│ rpc-bridge.ts              │         └───────────────────────┘
└─────────────┬──────────────┘
              │ IPC
              ▼
┌── Renderer (React) ────────┐
│ Sidebar + adaptive bar     │
└─────────────┬──────────────┘
              │ hosts
              ▼
┌── Embedded BrowserViews ───┐
│ viewA: job portal (CDP)    │
│ viewB: tailor (on demand)  │
│ __webapp__ / __gmail__ /   │
│ __outlook__: ambient nav   │
└────────────────────────────┘
```

Single WebSocket carries CDP commands, navigation, file sync, panel switches, and pubsub events. Renderer holds no Supabase client and no other network surface — CSP `connect-src 'self'` enforces this.

Full reference: [`CLAUDE.md`](./CLAUDE.md). Cross-repo architecture across desktop-app + web-api + web-app: [`workstreams/browser/`](https://github.com/jorb-ai/jorb-ai/tree/main/workstreams/browser) in the HQ repo.

## Source structure

```
src/
├── main/         Electron main process — windows, panels, WS, IPC handlers
├── preload/      contextBridge surfaces (preload + preload-webview)
├── renderer/     React app — sidebar, action bar, components
└── types/        Shared types (config + IPC channel enum)
```

See [`CLAUDE.md`](./CLAUDE.md) "Source Structure" for the per-file inventory.

## Conventions

- Single branch (`main`); no feature branches.
- All logs through `electron-log`; never raw `console.*` in main.
- Bracket prefix on every log message: `[ModuleName]`.
- No emoji in logs.
- Renderer never imports `@supabase/supabase-js`. CSP enforces it.
- Action bar height stays binary: `0` (hidden) or `96` (JorbHeader).

## Related repos

- **[`web-api`](https://github.com/jorb-ai/web-api)** — FastAPI backend, agent orchestrator
- **[`web-app`](https://github.com/jorb-ai/web-app)** — React webapp (loaded as `__webapp__` and inside `/tailor/*`)
- **[`web-public`](https://github.com/jorb-ai/web-public)** — Next.js SEO surface at `jorb.ai`
- **[`chrome-extension`](https://github.com/jorb-ai/chrome-extension)** — LinkedIn save button

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built by [Jorb AI](https://jorb.ai)

</div>
