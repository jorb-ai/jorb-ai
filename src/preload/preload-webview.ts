import { contextBridge, ipcRenderer } from 'electron';

// Electron detection flag — available before any page JS runs.
// This must be in the preload (not did-finish-load injection) so the web app's
// onAuthStateChange handler can see it during initial hydration.
contextBridge.exposeInMainWorld('__FINBRO_ENV__', { isElectron: true });

// BrowserView bridge — auth token push for the web app
contextBridge.exposeInMainWorld('finbro', {
  sendAuthToken: async (token: string | null) => {
    return ipcRenderer.invoke('auth:send-token', { token });
  },
});
