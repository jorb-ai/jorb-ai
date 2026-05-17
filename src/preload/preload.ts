import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const IpcChannel = {
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  AUTH_SEND_TOKEN: 'auth:send-token',
  AUTH_TOKEN_CHANGED: 'auth:token-changed',
  BROWSER_STOP: 'browser:stop',
  BROWSER_CLOSE: 'browser:close',
  PANEL_NAVIGATE: 'panel:navigate',
  PANEL_SET_BAR_HEIGHT: 'panel:set-bar-height',
  SESSION_SHOW: 'session:show',
  SESSION_SHOW_TAILOR: 'session:show-tailor',
  SESSION_DESTROY: 'session:destroy',
  SESSION_STATUS: 'session:status',
  SESSION_ACTIVE_CHANGED: 'session:active-changed',
  RPC_REQUEST: 'rpc:request',
  RPC_SUBSCRIBE: 'rpc:subscribe',
  RPC_UNSUBSCRIBE: 'rpc:unsubscribe',
  RPC_EVENT: 'rpc:event',
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
      const handler = (_event: IpcRendererEvent, token: string | null) => callback(token);
      ipcRenderer.on(IpcChannel.AUTH_TOKEN_CHANGED, handler);
      return () => ipcRenderer.removeListener(IpcChannel.AUTH_TOKEN_CHANGED, handler);
    },
  },

  browser: {
    stop: async (jobId: string) => {
      return ipcRenderer.invoke(IpcChannel.BROWSER_STOP, { jobId });
    },
    close: async (jobId: string) => {
      return ipcRenderer.invoke(IpcChannel.BROWSER_CLOSE, { jobId });
    },
  },

  panel: {
    // sessionId defaults to '__webapp__' on the main side when omitted.
    // Pass an explicit id (e.g. '__gmail__', '__outlook__') to host a
    // different origin in its own persistent BrowserView.
    navigate: async (url: string, sessionId?: string) => {
      return ipcRenderer.invoke(IpcChannel.PANEL_NAVIGATE, { url, sessionId });
    },
    // Renderer notifies main of the current action-bar height (44 or 96)
    // so BrowserView bounds stay aligned with the HTML chrome.
    setBarHeight: async (height: number) => {
      return ipcRenderer.invoke(IpcChannel.PANEL_SET_BAR_HEIGHT, { height });
    },
  },

  session: {
    show: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_SHOW, { sessionId });
    },
    showTailor: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_SHOW_TAILOR, { sessionId });
    },
    destroy: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_DESTROY, { sessionId });
    },
    status: async () => {
      return ipcRenderer.invoke(IpcChannel.SESSION_STATUS);
    },
    // One-way listener — fires whenever main brings a session to the
    // front (user click OR worker auto-jump). Renderer mirrors into
    // activeJobId so the sidebar pill follows what's actually on top.
    onActiveChanged: (callback: (sessionId: string) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { sessionId: string }) => callback(payload?.sessionId);
      ipcRenderer.on(IpcChannel.SESSION_ACTIVE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IpcChannel.SESSION_ACTIVE_CHANGED, handler);
    },
  },

  rpc: {
    request: async (msg: unknown) => ipcRenderer.invoke(IpcChannel.RPC_REQUEST, msg),
    subscribe: async () => ipcRenderer.invoke(IpcChannel.RPC_SUBSCRIBE),
    unsubscribe: async () => ipcRenderer.invoke(IpcChannel.RPC_UNSUBSCRIBE),
    onEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, event: unknown) => callback(event);
      ipcRenderer.on(IpcChannel.RPC_EVENT, handler);
      return () => { ipcRenderer.removeListener(IpcChannel.RPC_EVENT, handler); };
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
