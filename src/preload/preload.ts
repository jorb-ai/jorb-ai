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
  SESSION_PRELOAD_INBOX: 'session:preload-inbox',
  SESSION_DESTROY: 'session:destroy',
  SESSION_STATUS: 'session:status',
  SESSION_ACTIVE_CHANGED: 'session:active-changed',
  SESSION_NAV_STATE: 'session:nav-state',
  SESSION_NAV_STATE_GET: 'session:nav-state-get',
  SESSION_HISTORY_GO: 'session:history-go',
  RPC_REQUEST: 'rpc:request',
  RPC_SUBSCRIBE: 'rpc:subscribe',
  RPC_UNSUBSCRIBE: 'rpc:unsubscribe',
  RPC_EVENT: 'rpc:event',
  DEV_IMPORT_COOKIES: 'dev:import-cookies',
  RENDERER_LOG: 'renderer:log',
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
    // Renderer notifies main of the current action-bar height (0 / 84 / 112) so BrowserView bounds stay
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
    // Inbox-access: show the per-inbox BrowserView, creating it at the
    // Gmail root if it does not exist yet. Used by the sidebar InboxRow.
    showOrNavigateInbox: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_SHOW_OR_NAVIGATE_INBOX, { sessionId });
    },
    // Background-preload an inbox view at Gmail root (fire-and-forget;
    // never changes z-order). Fired per row when the inbox list lands.
    preloadInbox: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_PRELOAD_INBOX, { sessionId });
    },
    destroy: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_DESTROY, { sessionId });
    },
    status: async () => {
      return ipcRenderer.invoke(IpcChannel.SESSION_STATUS);
    },
    // One-way listener — fires whenever main selects a session (user click
    // OR worker auto-jump). Renderer mirrors into activeJobId so the
    // sidebar pill follows what's actually on top; `loading: true` means
    // the tab hasn't painted yet (all views detached) and the renderer
    // shows the loading skeleton until the `loading: false` push lands.
    onActiveChanged: (callback: (sessionId: string, loading: boolean) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { sessionId: string; loading?: boolean }) =>
        callback(payload?.sessionId, !!payload?.loading);
      ipcRenderer.on(IpcChannel.SESSION_ACTIVE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IpcChannel.SESSION_ACTIVE_CHANGED, handler);
    },
    // Browser-chrome nav strip: initial pull, live pushes, back/forward.
    getNavState: async (sessionId: string) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_NAV_STATE_GET, { sessionId });
    },
    historyGo: async (sessionId: string, delta: number) => {
      return ipcRenderer.invoke(IpcChannel.SESSION_HISTORY_GO, { sessionId, delta });
    },
    onNavState: (callback: (state: { sessionId: string; url: string; canGoBack: boolean; canGoForward: boolean }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, state: { sessionId: string; url: string; canGoBack: boolean; canGoForward: boolean }) => callback(state);
      ipcRenderer.on(IpcChannel.SESSION_NAV_STATE, handler);
      return () => ipcRenderer.removeListener(IpcChannel.SESSION_NAV_STATE, handler);
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

  // Dev observability: forward a renderer-side state transition to the main
  // electron-log so an agent watching the observer pod can see it (the
  // renderer's own console is DevTools-only). Fire-and-forget, no round-trip.
  debug: (scope: string, msg: string) => ipcRenderer.send(IpcChannel.RENDERER_LOG, { scope, msg }),

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
