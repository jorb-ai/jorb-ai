# CLAUDE.md

Orientation for AI agents working in this repository. Humans land on [`README.md`](./README.md); this file is for agents picking up the codebase.

## What this app is

The Jorb AI desktop application — an Electron shell that hosts an embedded browser, watches the Jorb agent fill out job applications inside it, and lets the user approve tailored resumes and cover letters mid-flow. Form input is driven through Chrome DevTools Protocol so keystrokes look human at the browser-engine level.

## Architecture

```
                          ╭─────────────────────╮
                          │         You         │
                          │  watch · approve    │
                          │       · stop        │
                          ╰──────────┬──────────╯
                                     │
                                     ▼
        ╭────────────────────────────────────────────────────────╮
        │                    Jorb AI Desktop                     │
        │                                                        │
        │     ╭──────────────────────────────────────────╮       │
        │     │       the job application portal         │       │
        │     │         ( real keystrokes — CDP )        │       │
        │     ╰──────────────────────────────────────────╯       │
        ╰─────────────────────────┬──────────────────────────────╯
                                  │
                                  │  WebSocket
                                  ▼
                    ╭───────────────────────────╮
                    │         Jorb Agent        │
                    │      reads the page       │
                    │      tailors documents    │
                    │      decides next step    │
                    ╰───────────────────────────╯
```

The shell does no business logic of its own. It holds a single WebSocket open to the Jorb cloud and faithfully executes whatever CDP commands arrive over it. All intelligence — page parsing, decision-making, document tailoring — happens server-side. This separation is intentional: the desktop binary stays small, transparent, and easy to audit; the agent stays free to evolve without shipping new app versions to every user.

The window itself is a two-panel layout. A floating glass sidebar lists active sessions and ambient navigation tabs. The middle panel hosts the embedded browser view: usually the live job application portal, sometimes a tailoring page where the user reviews and approves a document before upload. An adaptive header bar above the browser surfaces the agent's current state.

## Source layout

```
src/
├── main/         Electron main process — window, browser views,
│                 WebSocket, file sync, IPC handlers
├── preload/      contextBridge surfaces — the main renderer and the
│                 embedded browser views talk to main through these
├── renderer/     React app — sidebar, header bar, components, styles
└── types/        Shared types (config + IPC channels)
```

## Visual language

The app shares its visual vocabulary with the Jorb AI web experience: a flush-white surface, a single primary accent (`#290E99`), a Tailwind-aligned neutral scale, and the system font stack. Motion is restrained — quiet pulses rather than spinners, ambient sweeps rather than flashes. The action bar carries the agent's voice through a friendly mascot and a single speech bubble that re-keys per state.

When the agent is working, a subtle gradient sweep moves across that session's sidebar row — a wordless "I'm on it." When the agent needs you to approve something, the row turns warm amber. When a job is finished, a soft green pulse stays until you've checked the result.

## Browser parity

The shell is a browser at heart — tabs, switching, loading, closing. Where it shares behaviour with a real browser, it matches the convention. Users arrive with Chrome and Safari muscle memory; the goal is to honour it, never fight it.

- Switching tabs is a z-order change. Tabs preserve scroll, form state, and sign-in.
- A tab loads once on first open and persists afterwards.
- Closing a tab is immediate and irreversible, and the close affordance is always reachable.
- A tab that is loading, or that failed to load, says so — never blank, never stale.

Becoming a general-purpose browser is not the goal (no address bar, no bookmarks). For the browser-like things the shell does do, it does them the browser way.

## Communication

One WebSocket carries every signal between the desktop app and the cloud: navigation, document tailoring, file sync, approval, and a live pubsub stream of session state. The renderer never opens its own network connections — all data flows through the main process. Content Security Policy enforces this at the browser level.

## License

[MIT](LICENSE) © 2026 Jorb AI
