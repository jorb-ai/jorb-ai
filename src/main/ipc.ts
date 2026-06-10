import { ipcMain, shell, IpcMainInvokeEvent } from 'electron';
import log from './logger';
import { IpcChannel } from '../types/ipc.types';
import { getConfig, getConfigValue, setConfig } from './config';
import { handleAuthToken } from './auth';
import { sendStopAutomation, sendUserContinued } from './websocket-client';
import { closeBrowserJob } from './http-client';
import {
  showSession,
  destroySession,
  getSessionCount,
  isAtCapacity,
  showOrNavigateSession,
  showOrNavigateInbox,
  preloadInbox,
  hasTailorView,
  getNavState,
  historyGo,
} from './panels';
import { setActionBarHeight } from './windows';
import { detectChromeProfiles } from './chrome-import/profiles';
import { importChromeProfileCookies } from './chrome-import/cookies';

// Origins allowed to invoke the web-app-only channels (auth token push,
// shell capabilities). Both are exposed solely by preload-webapp.ts; this
// sender check is defense-in-depth against a compromised/other view.
const WEBAPP_ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://jorb.ai',
  'https://www.jorb.ai',
  'https://dev.jorb.ai',
]);

function configuredWebAppOrigin(): string | null {
  try {
    const origin = new URL(getConfigValue('webAppUrl')).origin;
    if (
      origin === 'https://jorb.ai' ||
      origin === 'https://www.jorb.ai' ||
      origin === 'https://dev.jorb.ai' ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:')
    ) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function isAllowedWebAppSender(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return WEBAPP_ALLOWED_ORIGINS.has(url.origin) || url.origin === configuredWebAppOrigin();
  } catch {
    return false;
  }
}

export function registerIpcHandlers(): void {
  log.info('[IPC] Registering handlers...');

  // Sidebar nav — each external origin (webapp, Gmail, Outlook, ...)
  // gets its own persistent session so switching between them only
  // toggles z-order rather than reloading a shared view. `sessionId`
  // defaults to '__webapp__' for backwards-compatible callers.
  ipcMain.handle(IpcChannel.PANEL_NAVIGATE, async (_event: IpcMainInvokeEvent, args: { url: string; sessionId?: string }) => {
    const sid = args.sessionId ?? '__webapp__';
    await showOrNavigateSession(sid, args.url);
  });

  ipcMain.handle(IpcChannel.PANEL_SET_BAR_HEIGHT, async (_event: IpcMainInvokeEvent, args: { height: number }) => {
    setActionBarHeight(args.height);
  });

  ipcMain.handle(IpcChannel.CONFIG_GET, async () => {
    return { config: getConfig() };
  });

  ipcMain.handle(IpcChannel.CONFIG_SET, async (_event: IpcMainInvokeEvent, args: { config: any }) => {
    setConfig(args.config);
  });

  ipcMain.handle(IpcChannel.AUTH_SEND_TOKEN, async (event: IpcMainInvokeEvent, args: { token: string | null }) => {
    const sender = event.sender;
    const senderUrl = sender.getURL() || '<empty>';
    const senderType = sender.getType();
    if (!isAllowedWebAppSender(senderUrl)) {
      log.warn(`[IPC] AUTH_SEND_TOKEN rejected: sender=${senderType} @ ${senderUrl}`);
      return;
    }
    log.info(`[IPC] AUTH_SEND_TOKEN accepted: sender=${senderType} @ ${senderUrl}`);
    handleAuthToken(args.token);
  });

  // Open a URL in the OS default browser. The shell denies window.open
  // globally (main.ts), so this is web-app's only way out - used for
  // "Open in browser" affordances on job links. Web-app senders only;
  // http/https only (never file:// or app protocols). contracts.md C16.
  ipcMain.handle(IpcChannel.SHELL_OPEN_EXTERNAL, async (event: IpcMainInvokeEvent, args: { url: string }) => {
    const senderUrl = event.sender.getURL() || '<empty>';
    if (!isAllowedWebAppSender(senderUrl)) {
      log.warn(`[IPC] SHELL_OPEN_EXTERNAL rejected: sender @ ${senderUrl}`);
      return;
    }
    try {
      const url = new URL(args.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        log.warn(`[IPC] SHELL_OPEN_EXTERNAL rejected: scheme ${url.protocol}`);
        return;
      }
      log.info(`[IPC] SHELL_OPEN_EXTERNAL – ${url.origin}${url.pathname}`);
      await shell.openExternal(url.toString());
    } catch {
      log.warn(`[IPC] SHELL_OPEN_EXTERNAL rejected: unparseable url`);
    }
  });

  ipcMain.handle(IpcChannel.BROWSER_STOP, async (_event: IpcMainInvokeEvent, args: { jobId: string }) => {
    log.info('[IPC] Stop automation — job:', args.jobId);
    sendStopAutomation(args.jobId);
  });

  ipcMain.handle(IpcChannel.BROWSER_CONTINUE, async (_event: IpcMainInvokeEvent, args: { jobId: string }) => {
    log.info('[IPC] Continue automation — job:', args.jobId);
    sendUserContinued(args.jobId);
  });

  ipcMain.handle(IpcChannel.BROWSER_CLOSE, async (_event: IpcMainInvokeEvent, args: { jobId: string }) => {
    log.info('[IPC] Close session — job:', args.jobId);
    await closeBrowserJob(args.jobId);
  });

  // Session lifecycle. Returns 'shown' | 'loading' | 'none' — on 'none'
  // the renderer navigates the session to the job's posting URL (the
  // skeleton is already up either way; see panels.ts showSession).
  ipcMain.handle(IpcChannel.SESSION_SHOW, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    return showSession(args.sessionId);
  });

  // Browser-chrome nav strip: initial-state pull + back/forward command.
  // Live updates ride the SESSION_NAV_STATE push from panels.ts.
  ipcMain.handle(IpcChannel.SESSION_NAV_STATE_GET, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    return getNavState(args.sessionId);
  });

  ipcMain.handle(IpcChannel.SESSION_HISTORY_GO, async (_event: IpcMainInvokeEvent, args: { sessionId: string; delta: number }) => {
    historyGo(args.sessionId, args.delta);
  });

  ipcMain.handle(IpcChannel.SESSION_SHOW_TAILOR, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    if (hasTailorView(args.sessionId)) {
      return showSession(args.sessionId) === 'shown';
    }
    return false;
  });

  ipcMain.handle(IpcChannel.SESSION_DESTROY, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    destroySession(args.sessionId);
  });

  // Inbox-access: open a per-inbox BrowserView. Sidebar InboxRow click:
  // show the existing tab; create + load it at the Gmail root if missing.
  ipcMain.handle(
    IpcChannel.SESSION_SHOW_OR_NAVIGATE_INBOX,
    async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
      await showOrNavigateInbox(args.sessionId);
    },
  );

  // Inbox-access: background-preload an inbox view (eager preload — the
  // renderer fires one per row when its inbox list lands). Fire-and-forget
  // semantics for the caller; panels.ts logs the outcome.
  ipcMain.handle(
    IpcChannel.SESSION_PRELOAD_INBOX,
    async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
      await preloadInbox(args.sessionId);
    },
  );

  ipcMain.handle(IpcChannel.SESSION_STATUS, async () => {
    return { count: getSessionCount(), atCapacity: isAtCapacity() };
  });

  // Dev-only: graft the user's real Chrome cookies into persist:portal so a
  // freshly-cleared dev session is logged in on job portals (and Google SSO).
  // Auto-picks Chrome's Default profile. The engine (chrome-import/) is
  // production-bound; only this trigger is makeshift. Runs the default
  // direct-decrypt path (one-time keychain prompt in dev); a signed production
  // build would use the prompt-free spawn path instead.
  ipcMain.handle(IpcChannel.DEV_IMPORT_COOKIES, async () => {
    try {
      const profiles = detectChromeProfiles();
      if (!profiles.length) {
        return { ok: false, error: 'No Chromium profile with cookies found. Sign in to Chrome first.' };
      }
      const pick = profiles.find((p) => p.browserKey === 'google-chrome' && p.directory === 'Default') ?? profiles[0];
      log.info(`[IPC] dev:import-cookies — using ${pick.browserName} / ${pick.directory}`);
      const result = await importChromeProfileCookies(pick.id);
      log.info(`[IPC] dev:import-cookies — imported ${result.imported}/${result.total} cookies, ${result.domains.length} domains -> persist:portal`);
      return { ok: true, browserName: result.browserName, profile: pick.directory, imported: result.imported, total: result.total, domains: result.domains.length };
    } catch (err) {
      log.error(`[IPC] dev:import-cookies — failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  });

  // Dev observability: renderer state transitions -> main electron-log. The
  // renderer otherwise logs only to DevTools console, invisible to an agent
  // watching the observer pod. One-way (send/on), so it never blocks the
  // renderer. Tagged [Renderer] so it reads as a forwarded line.
  ipcMain.on(IpcChannel.RENDERER_LOG, (_event, args: { scope: string; msg: string }) => {
    log.info(`[Renderer] ${args?.scope ?? '?'}: ${args?.msg ?? ''}`);
  });

  log.info('[IPC] All handlers registered');
}
