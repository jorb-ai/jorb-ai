# Jorb AI — Desktop App

The desktop application for [jorb.ai](https://jorb.ai). Automates job applications using an AI agent that fills forms via Chrome DevTools Protocol.

## How It Works

The app is a three-panel Electron shell:
- **Left** — Active agent sessions
- **Middle** — BrowserView showing the job portal (CDP-attached)
- **Right** — Real-time activity feed

An AI agent on the API reads the page, decides what to fill, and sends CDP commands back to the app. The user watches in real time and can stop the agent at any step.

## Development

```bash
npm install
npm run dev
```

## License

MIT — See [LICENSE](LICENSE) for details.

Built by [Jorb AI](https://jorb.ai)
