import { ipcMain, BrowserWindow } from 'electron';
import log from './logger';
import { sendWsMessage, onWsServerMessage } from './websocket-client';

/**
 * Wire the renderer-side rpc.ts module to the main-process WebSocket.
 *
 * Renderer sends a message → ipcMain.handle forwards to WS.
 * Server replies → websocket-client.handleServerMessage fans out to
 *   registered listeners → we forward each to the renderer as 'rpc:event'.
 *
 * The renderer correlates responses back to their pending Promises by the
 * `id` field it supplied. Server-push messages (no id) are routed by type.
 */
export function registerRpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('rpc:request', async (_e, message: unknown) => {
    sendWsMessage(message);
  });
  ipcMain.handle('rpc:subscribe', async () => {
    sendWsMessage({ type: 'subscribe' });
  });
  ipcMain.handle('rpc:unsubscribe', async () => {
    sendWsMessage({ type: 'unsubscribe' });
  });

  // Forward every server WS message to the renderer. The renderer's rpc.ts
  // filters by id/type and ignores CDP/navigate/file-sync/panel-switch
  // messages, which are handled in-main via the existing dispatch.
  onWsServerMessage((message: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.webContents.send('rpc:event', message);
    } catch (e) {
      log.error('[RpcBridge] send rpc:event failed:', e);
    }
  });

  log.info('[RpcBridge] registered ipc handlers + server-message forwarder');
}
