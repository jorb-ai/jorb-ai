import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const IpcChannel = {
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  AUTH_SEND_TOKEN: 'auth:send-token',
  AUTH_TOKEN_CHANGED: 'auth:token-changed',
  BROWSER_STOP: 'browser:stop',
  BROWSER_CONTINUE: 'browser:continue',
  BROWSER_CLOSE: 'browser:close',
  PANEL_NAVIGATE: 'panel:navigate',
  PANEL_SET_BAR_HEIGHT: 'panel:set-bar-height',
  SESSION_SHOW: 'session:show',
  SESSION_SHOW_TAILOR: 'session:show-tailor',
  SESSION_SHOW_OR_NAVIGATE_INBOX: 'session:show-or-navigate-inbox',
  SESSION_DESTROY: 'session:destroy',
  SESSION_STATUS: 'session:status',
  SESSION_ACTIVE_CHANGED: 'session:active-changed',
  RPC_REQUEST: 'rpc:request',
  RPC_SUBSCRIBE: 'rpc:subscribe',
  RPC_UNSUBSCRIBE: 'rpc:unsubscribe',
  RPC_EVENT: 'rpc:event',
  DEV_IMPORT_COOKIES: 'dev:import-cookies',
} as const;

const finbroApi = {
  config: {
    get: async () => ipcRenderer.invoke(IpcChannel.CONFIG_GET),
    set: async (config: any) => ipcRenderer.invoke(IpcChannel.CONFIG_SET, { config }),
  },

  auth: {
    onTokenChanged: (callback: (state: { isAuthenticated: boolean; userId: string | null }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, state: { isAuthenticated: boolean; userId: string | null }) => callback(state);
      ipcRenderer.on(IpcChannel.AUTH_TOKEN_CHANGED, handler);
      return () => ipcRenderer.removeListener(IpcChannel.AUTH_TOKEN_CHANGED, handler);
    },
  },

  browser: {
    stop: async (jobId: string) => {
      return ipcRenderer.invoke(IpcChannel.BROWSER_STOP, { jobId });
    },
    // Inbox-access: user clicked Continue in the action bar's
    // paused_for_user state. Fires user_continued over the WS.
    continueJob: async (jobId: string) => {
      return ipcRenderer.invoke(IpcChannel.BROWSER_CONTINUE, { jobId });
    },
    close: async (jobId: string) => {
      return ipcRenderer.invoke(IpcChannel.BROWSER_CLOSE, { jobId });
    },
  },

  panel: {
    // sessionId defaults to '__webapp__' on the main side when omitted.
    // Pass an explicit id, for example an `__inbox_<id>__` session, to host
    // a different origin in its own persistent BrowserView.
    navigate: async (url: string, sessionId?: string) => {
      return ipcRenderer.invoke(IpcChannel.PANEL_NAVIGATE, { url, sessionId });
    },
    // Renderer notifies main of the current action-bar height (0, 96, or 122
    // — 122 is the paused_for_user variant) so BrowserView bounds stay
    // aligned with the HTML chrome.
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
    // Inbox-access: open / re-search a per-inbox BrowserView. Omitting
    // `url` defaults to the Gmail root. Used by the sidebar InboxRow
    // (no url) and the JorbHeader pre-search affordance (url = the
    // EmailAgent's exact search URL, lands the user pre-searched).
    showOrNavigateInbox: async (sessionId: string, url?: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_SHOW_OR_NAVIGATE_INBOX, { sessionId, url });
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

  // Dev-only: graft the user's real Chrome cookies into persist:portal.
  // Makeshift trigger for the chrome-import engine; gated to dev in the UI.
  dev: {
    importCookies: async (): Promise<{ ok: boolean; error?: string; browserName?: string; profile?: string; imported?: number; total?: number; domains?: number }> =>
      ipcRenderer.invoke(IpcChannel.DEV_IMPORT_COOKIES),
  },
};

// Main renderer API
contextBridge.exposeInMainWorld('Finbro', finbroApi);

export type FinbroApi = typeof finbroApi;
