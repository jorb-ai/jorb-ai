import { contextBridge, ipcRenderer } from 'electron';

const IpcChannel = {
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  AUTH_SEND_TOKEN: 'auth:send-token',
  AUTH_TOKEN_CHANGED: 'auth:token-changed',
  BROWSER_STOP: 'browser:stop',
  PANEL_NAVIGATE: 'panel:navigate',
  PANEL_RESIZE: 'panel:resize',
} as const;

const finbroApi = {
  config: {
    get: async () => ipcRenderer.invoke(IpcChannel.CONFIG_GET),
    set: async (config: any) => ipcRenderer.invoke(IpcChannel.CONFIG_SET, { config }),
  },

  auth: {
    sendAuthToken: async (token: string | null) => {
      return ipcRenderer.invoke(IpcChannel.AUTH_SEND_TOKEN, { token });
    },
    onTokenChanged: (callback: (token: string | null) => void): (() => void) => {
      const handler = (_event: any, token: string | null) => callback(token);
      ipcRenderer.on(IpcChannel.AUTH_TOKEN_CHANGED, handler);
      return () => ipcRenderer.removeListener(IpcChannel.AUTH_TOKEN_CHANGED, handler);
    },
  },

  browser: {
    stop: async (jobId: string) => {
      return ipcRenderer.invoke(IpcChannel.BROWSER_STOP, { jobId });
    },
  },

  panel: {
    navigate: async (url: string) => {
      return ipcRenderer.invoke(IpcChannel.PANEL_NAVIGATE, { url });
    },
    resize: async (width: number) => {
      return ipcRenderer.invoke(IpcChannel.PANEL_RESIZE, { width });
    },
  },
};

// Main renderer API
contextBridge.exposeInMainWorld('Finbro', finbroApi);

// Web app compatibility bridge (for BrowserView auth token push)
contextBridge.exposeInMainWorld('finbro', {
  sendAuthToken: async (token: string | null) => {
    return ipcRenderer.invoke(IpcChannel.AUTH_SEND_TOKEN, { token });
  },
});

export type FinbroApi = typeof finbroApi;
