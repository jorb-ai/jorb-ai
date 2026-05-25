import { ipcMain, IpcMainInvokeEvent } from 'electron';
import log, { tokenPrefix } from './logger';
import { IpcChannel } from '../types/ipc.types';
import { getConfig, setConfig } from './config';
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
  hasTailorView,
} from './panels';
import { setActionBarHeight } from './windows';

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
    log.info(`[IPC] AUTH_SEND_TOKEN — sender: ${senderType} @ ${senderUrl}, token: ${tokenPrefix(args.token)}`);
    handleAuthToken(args.token);
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

  // Session lifecycle
  ipcMain.handle(IpcChannel.SESSION_SHOW, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    return showSession(args.sessionId);
  });

  ipcMain.handle(IpcChannel.SESSION_SHOW_TAILOR, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    if (hasTailorView(args.sessionId)) {
      return showSession(args.sessionId);
    }
    return false;
  });

  ipcMain.handle(IpcChannel.SESSION_DESTROY, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    destroySession(args.sessionId);
  });

  // Inbox-access: open / re-search a per-inbox BrowserView. Used by:
  //   - sidebar InboxRow click (no url -> show existing tab; create at
  //     Gmail root only if missing)
  //   - JorbHeader pre-search affordance (url = the EmailAgent's exact
  //     search URL, lands the user pre-searched for the right sender).
  // The explicit-url path navigates even if the session exists, side-stepping
  // the origin-match short-circuit that would swallow Gmail-search fragment
  // changes.
  ipcMain.handle(
    IpcChannel.SESSION_SHOW_OR_NAVIGATE_INBOX,
    async (
      _event: IpcMainInvokeEvent,
      args: { sessionId: string; url?: string },
    ) => {
      await showOrNavigateInbox(args.sessionId, args.url);
    },
  );

  ipcMain.handle(IpcChannel.SESSION_STATUS, async () => {
    return { count: getSessionCount(), atCapacity: isAtCapacity() };
  });

  log.info('[IPC] All handlers registered');
}
