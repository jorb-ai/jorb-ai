import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__ELECTRON_ENV__', { isElectron: true });

// Web-app-only bridge. Portal and inbox BrowserViews use preload-webview.ts,
// which intentionally exposes no capability surface.
contextBridge.exposeInMainWorld('electron', {
  sendAuthToken: async (token: string | null) => {
    return ipcRenderer.invoke('auth:send-token', { token });
  },
  // The shell denies window.open globally (main.ts), so web-app opens
  // external URLs in the OS default browser through this. contracts.md C16.
  openExternal: async (url: string) => {
    return ipcRenderer.invoke('shell:open-external', { url });
  },
});
