import { contextBridge, ipcRenderer } from 'electron';

// BrowserView bridge — only exposes auth token push for the web app
contextBridge.exposeInMainWorld('finbro', {
  sendAuthToken: async (token: string | null) => {
    return ipcRenderer.invoke('auth:send-token', { token });
  },
});
