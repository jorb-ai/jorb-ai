import { ipcMain, IpcMainInvokeEvent } from 'electron';
import log, { tokenPrefix } from './logger';
import { IpcChannel } from '../types/ipc.types';
import { getConfig, setConfig } from './config';
import { handleAuthToken } from './auth';
import { sendStopAutomation } from './websocket-client';
import {
  showSession,
  showPlaceholder,
  destroySession,
  getSessionCount,
  isAtCapacity,
  navigateSession,
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
    await navigateSession(sid, args.url);
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

  ipcMain.handle(IpcChannel.SESSION_SHOW_PLACEHOLDER, async () => {
    showPlaceholder();
  });

  ipcMain.handle(IpcChannel.SESSION_DESTROY, async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
    destroySession(args.sessionId);
  });

  ipcMain.handle(IpcChannel.SESSION_STATUS, async () => {
    return { count: getSessionCount(), atCapacity: isAtCapacity() };
  });

  log.info('[IPC] All handlers registered');
}
