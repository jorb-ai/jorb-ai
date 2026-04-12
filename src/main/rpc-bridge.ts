import { ipcMain, BrowserWindow } from 'electron';
import log from './logger';
import { sendWsMessage, onWsServerMessage } from './websocket-client';
import { IpcChannel } from '../types/ipc.types';

/**
 * Wire the renderer-side rpc.ts module to the main-process WebSocket.
 *
 * This is a hard boundary. The renderer is a separate context and must
 * not be able to forge privileged messages (register as another user,
 * impersonate a CDP response, stop an arbitrary job, etc.). Likewise,
 * not every server-side message is appropriate to surface to the
 * renderer — CDP payloads and signed URLs stay in the main process.
 *
 * Allowlists on both directions enforce this at the narrowest chokepoint.
 */

// Renderer → server: only data-plane requests owned by rpc.ts. Dedicated
// IPC channels (browser:stop, session:*, panel:*) have their own
// validation paths and do not come through rpc:request.
const RENDERER_ALLOWED_MSG_TYPES: ReadonlySet<string> = new Set([
  'list_browser_jobs',
  'watch_agent_job',
  'unwatch_agent_job',
]);

// Server → renderer: only the types rpc.ts actually consumes. CDP
// commands (action='cdp'/'navigate'/'file_upload' — no `type` field),
// panel_switch, file_sync_*, registered, pong, stop_acknowledged are
// all handled inside the main process and must not leak to the
// renderer.
const SERVER_ALLOWED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'browser_jobs_list',
  'browser_job_inserted',
  'browser_job_updated',
  'agent_job',
  'agent_job_updated',
  'subscribed',
  'error', // rpc.ts rejects correlated promises on error responses
]);

// Mutable ref to the current main window. Required because Electron's
// app.on('activate', ...) re-creates the window on macOS and the prior
// object is destroyed. Capturing the initial mainWindow in a closure
// leaves the event listener permanently targeting a dead webContents.
let currentMainWindow: BrowserWindow | null = null;

/**
 * Register IPC handlers + the server-message forwarder once at startup.
 * Safe to call only ONCE per app lifetime; use `setMainWindow` to swap
 * the target window on macOS re-activate.
 */
export function registerRpcHandlers(mainWindow: BrowserWindow): void {
  setMainWindow(mainWindow);

  ipcMain.handle(IpcChannel.RPC_REQUEST, async (_e, message: unknown) => {
    const type = (message as { type?: string } | null)?.type;
    if (!type || !RENDERER_ALLOWED_MSG_TYPES.has(type)) {
      log.warn(`[RpcBridge] rejected rpc:request — disallowed type: ${type ?? '<none>'}`);
      return;
    }
    sendWsMessage(message);
  });

  ipcMain.handle(IpcChannel.RPC_SUBSCRIBE, async () => {
    sendWsMessage({ type: 'subscribe' });
  });

  ipcMain.handle(IpcChannel.RPC_UNSUBSCRIBE, async () => {
    sendWsMessage({ type: 'unsubscribe' });
  });

  onWsServerMessage((message: unknown) => {
    const win = currentMainWindow;
    if (!win || win.isDestroyed()) return;

    // Every renderer-bound message must carry a `type` AND be on the
    // allowlist. CDP/navigate/file_upload carry `action` (no `type`) and
    // are correctly filtered out by the `!m?.type` guard.
    const m = message as { type?: string } | null;
    if (!m?.type || !SERVER_ALLOWED_EVENT_TYPES.has(m.type)) return;

    try {
      win.webContents.send(IpcChannel.RPC_EVENT, message);
    } catch (e) {
      log.error('[RpcBridge] send rpc:event failed:', e);
    }
  });

  log.info('[RpcBridge] registered ipc handlers + server-message forwarder');
}

/**
 * Update the target window for server-message forwarding. Called at
 * startup (via registerRpcHandlers) and on macOS re-activate when a new
 * window is created. Clears the ref when the window is closed so a
 * subsequent server message does not try to send into destroyed
 * webContents.
 */
export function setMainWindow(mainWindow: BrowserWindow): void {
  currentMainWindow = mainWindow;
  mainWindow.on('closed', () => {
    if (currentMainWindow === mainWindow) {
      currentMainWindow = null;
    }
  });
}
