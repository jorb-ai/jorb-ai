import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '../types/ipc.types';
import { getConfig, setConfig } from './config';
import { handleAuthToken } from './auth';
import { sendStopAutomation } from './websocket-client';
import { navigateTo, getCurrentUrl } from './panels';

export function registerIpcHandlers(): void {
  console.log('[IPC] Registering handlers...');

  ipcMain.handle(IpcChannel.PANEL_NAVIGATE, async (_event: IpcMainInvokeEvent, args: { url: string }) => {
    await navigateTo(args.url);
  });

  ipcMain.handle(IpcChannel.PANEL_GET_TAB_ID, async () => {
    return { url: getCurrentUrl() };
  });

  ipcMain.handle(IpcChannel.CONFIG_GET, async () => {
    return { config: getConfig() };
  });

  ipcMain.handle(IpcChannel.CONFIG_SET, async (_event: IpcMainInvokeEvent, args: { config: any }) => {
    setConfig(args.config);
  });

  ipcMain.handle(IpcChannel.AUTH_SEND_TOKEN, async (_event: IpcMainInvokeEvent, args: { token: string | null }) => {
    console.log('[IPC] Auth token received —', args.token ? 'login' : 'logout');
    handleAuthToken(args.token);
  });

  ipcMain.handle(IpcChannel.BROWSER_STOP, async (_event: IpcMainInvokeEvent, args: { jobId: string }) => {
    console.log('[IPC] Stop automation — job:', args.jobId);
    sendStopAutomation(args.jobId);
  });

  console.log('[IPC] All handlers registered');
}
