import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__FINBRO_ENV__', { isElectron: true });

// Web-app-only bridge. Portal and inbox BrowserViews use preload-webview.ts,
// which intentionally does not expose this auth surface.
contextBridge.exposeInMainWorld('finbro', {
  sendAuthToken: async (token: string | null) => {
    return ipcRenderer.invoke('auth:send-token', { token });
  },
});
