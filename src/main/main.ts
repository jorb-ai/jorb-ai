import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { registerIpcHandlers } from './ipc';
import { initFileSync } from './file-sync';

console.log('='.repeat(50));
console.log('jorb.ai — Starting');
console.log('Electron:', process.versions.electron);
console.log('Chrome:', process.versions.chrome);
console.log('='.repeat(50));

app.whenReady().then(async () => {
  console.log('[Main] App ready');

  await initFileSync();
  registerIpcHandlers();
  await createMainWindow();

  console.log('[Main] Initialization complete');

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
  console.log('[Main] Shutting down...');
});

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
