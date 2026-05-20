<div align="center">

<img src="src/renderer/assets/logos/logo_wordmark.png" alt="Jorb AI" width="280" />

<br/>
<br/>

### An AI agent applies to jobs for you. You watch every keystroke.

Job applications, fully automated. Resumes and cover letters, tailored on the fly.
Yours to review, yours to approve, yours to stop whenever you want.

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

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontFamily':'-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif', 'fontSize':'15px'}}}%%
flowchart TB
    classDef userBox    fill:#FEF3C7,stroke:#F59E0B,stroke-width:2.5px,color:#78350F
    classDef desktopBox fill:#F5F3FF,stroke:#7C3AED,stroke-width:2.5px,color:#5B21B6
    classDef portalBox  fill:#FFFFFF,stroke:#A1A1AA,stroke-width:1.5px,color:#3F3F46,stroke-dasharray:5 4
    classDef agentBox   fill:#E0F2FE,stroke:#0EA5E9,stroke-width:2.5px,color:#0C4A6E

    User(["👤  <b>You</b><br/><i>watch · approve · stop</i>"]):::userBox

    subgraph Desktop ["💻 &nbsp;<b>Jorb AI Desktop</b>"]
        Portal["the job application portal<br/><i>real keystrokes, sent via CDP</i>"]:::portalBox
    end

    Agent(["🧠  <b>Jorb Agent</b><br/><i>reads the page · tailors documents · decides the next step</i>"]):::agentBox

    User ==>|opens| Desktop
    Desktop <-.->|"&nbsp;WebSocket&nbsp;"| Agent

    style Desktop fill:#F5F3FF,stroke:#7C3AED,stroke-width:2.5px,color:#5B21B6
```

The desktop app embeds the real job application page inside its own window. The Jorb agent, your AI copilot in the cloud, reads the page, decides what to type, and ships those keystrokes back over a single WebSocket. The desktop replays them through Chrome DevTools Protocol, the same channel real browsers use to drive themselves. To the application portal, every keystroke looks like a human at the keyboard.

When the agent reaches a resume or cover letter upload, it pauses, tailors the document in your voice, and waits for your explicit approval before anything gets submitted.

<br/>

## What makes it different

🎹 &nbsp; **Real keystrokes, not JavaScript injection.**  
Most automation bots inject scripts or simulate clicks at the page level. Modern job portals detect that immediately. Jorb AI types through Chrome DevTools Protocol, the same interface real browsers use, so every input is indistinguishable from a human at the keyboard.

👀 &nbsp; **You stay in the loop.**  
Every keystroke is visible. Every tailored document is yours to review. The Stop button is always one click away. Nothing gets submitted without your eyes on it.

🔓 &nbsp; **Open. Auditable. Yours.**  
The code that runs on your computer is right here. No hidden binaries. No black box. Read it, fork it, ship it.

<br/>

## License

[MIT](LICENSE) © 2026 Jorb AI

<br/>

<div align="center">

Built with care at [jorb.ai](https://jorb.ai)

</div>
