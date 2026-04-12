import log from './logger';
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { registerIpcHandlers } from './ipc';
import { initFileSync } from './file-sync';
import { getConfigPath } from './config';
import { registerRpcHandlers } from './rpc-bridge';

log.info('jorb.ai starting — Electron:', process.versions.electron, '| Chrome:', process.versions.chrome);

app.whenReady().then(async () => {
  log.info('[Main] App ready');
  log.info('[Config] Storage path:', getConfigPath());

  await initFileSync();
  registerIpcHandlers();
  const mainWindow = await createMainWindow();
  registerRpcHandlers(mainWindow);

  log.info('[Main] Initialization complete');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  log.info('[Main] Shutting down...');
});

process.on('uncaughtException', (error) => {
  log.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('[Main] Unhandled rejection:', reason);
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
