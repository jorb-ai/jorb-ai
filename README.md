<div align="center">

<img src="src/renderer/assets/logos/logo_wordmark.png" alt="Jorb AI" width="280" />

<br/>
<br/>

### An AI agent applies to jobs for you. You watch every keystroke.

Job applications, fully automated. Resumes and cover letters, tailored on the fly.
Yours to review, yours to approve, yours to stop at any moment.

<br/>

[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey)](https://github.com/jorb-ai/desktop-app)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<br/>

**[jorb.ai](https://jorb.ai)**

</div>

<br/>

---

## How it works

```
                          ╭─────────────────────╮
                          │                     │
                          │         You         │
                          │                     │
                          │  watch · approve    │
                          │       · stop        │
                          │                     │
                          ╰──────────┬──────────╯
                                     │
                                     ▼
        ╭────────────────────────────────────────────────────────╮
        │                                                        │
        │                    Jorb AI Desktop                     │
        │                                                        │
        │     ╭──────────────────────────────────────────╮       │
        │     │                                          │       │
        │     │       the job application portal         │       │
        │     │         ( real keystrokes — CDP )        │       │
        │     │                                          │       │
        │     ╰──────────────────────────────────────────╯       │
        │                                                        │
        ╰─────────────────────────┬──────────────────────────────╯
                                  │
                                  │  WebSocket
                                  ▼
                    ╭───────────────────────────╮
                    │                           │
                    │         Jorb Agent        │
                    │                           │
                    │      reads the page       │
                    │      tailors documents    │
                    │      decides next step    │
                    │                           │
                    ╰───────────────────────────╯
```

The desktop app embeds the real job application page inside its own window. The Jorb agent — your AI copilot in the cloud — reads the page, decides what to type, and sends those keystrokes back over a single WebSocket. The desktop app replays them through Chrome DevTools Protocol, the same channel browsers use to drive themselves. To the application portal, every keystroke looks like a real human typing.

When the agent reaches a resume or cover letter upload, it pauses, tailors the document in your name, and waits for your explicit approval before submitting anything.

<br/>

## What makes it different

**Real keystrokes, not JavaScript injection.**  
Most automation bots inject scripts or simulate clicks at the page level. Modern job portals detect this immediately. Jorb AI types through Chrome DevTools Protocol — the same interface real browsers use — so every input is indistinguishable from a human at the keyboard.

**You stay in the loop.**  
Every keystroke is visible. Every tailored document is yours to review. The Stop button is always one click away. Nothing gets submitted without your eyes on it.

**Open. Auditable. On your machine.**  
The code that runs on your computer is right here. No hidden binaries. No black box. Read it, fork it, ship it.

<br/>

## License

[MIT](LICENSE) © 2026 Jorb AI

<br/>

<div align="center">

Built with care at [jorb.ai](https://jorb.ai)

</div>
