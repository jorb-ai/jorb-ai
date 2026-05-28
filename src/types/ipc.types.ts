import { AppConfig } from './config.types';

export enum IpcChannel {
  // Configuration
  CONFIG_GET = 'config:get',
  CONFIG_SET = 'config:set',

  // Authentication
  AUTH_SEND_TOKEN = 'auth:send-token',
  AUTH_TOKEN_CHANGED = 'auth:token-changed',

  // Session lifecycle
  SESSION_SHOW = 'session:show',
  SESSION_SHOW_TAILOR = 'session:show-tailor',
  SESSION_DESTROY = 'session:destroy',
  SESSION_STATUS = 'session:status',
  // Inbox-access: open / navigate the per-inbox BrowserView. Distinct
  // from PANEL_NAVIGATE because the inbox view ALWAYS navigates on this
  // call even when the session already exists at the same origin
  // (Gmail-search URL fragment changes between calls; the generic
  // showOrNavigateSession's origin-match short-circuit would swallow
  // the pre-search affordance). See workstreams/browser/inbox-access.md.
  SESSION_SHOW_OR_NAVIGATE_INBOX = 'session:show-or-navigate-inbox',
  // One-way main → renderer push: fired whenever panels.ts:showSession
  // brings a session to the front. Lets the renderer mirror activeJobId
  // when the worker auto-jumps via the `navigate` WS command. Without
  // this, the BrowserView swaps to the front but the sidebar row never
  // gets the active pill until the user clicks.
  SESSION_ACTIVE_CHANGED = 'session:active-changed',

  // Middle-panel navigation (system tabs route via showOrNavigateSession)
  PANEL_NAVIGATE = 'panel:navigate',
  // Renderer tells main how tall the action bar currently is so
  // BrowserView bounds are computed from the right offset.
  PANEL_SET_BAR_HEIGHT = 'panel:set-bar-height',

  // Browser automation
  BROWSER_STOP = 'browser:stop',
  // Inbox-access: user clicked Continue in the action bar after a
  // `paused_for_user` event. Fires `{type: 'user_continued', job_id}`
  // over WS. The existing Stop button is unchanged across this build;
  // Continue is the only new chrome the inbox-access work adds.
  BROWSER_CONTINUE = 'browser:continue',
  // User clicked X on a sidebar row — server stops (if running) + deletes
  // the browser_jobs row. Distinct from BROWSER_STOP, which only halts
  // execution and leaves the row.
  BROWSER_CLOSE = 'browser:close',

  // WS-backed RPC surface (Spec 4.3)
  RPC_REQUEST = 'rpc:request',
  RPC_SUBSCRIBE = 'rpc:subscribe',
  RPC_UNSUBSCRIBE = 'rpc:unsubscribe',
  RPC_EVENT = 'rpc:event',

  // Dev-only tooling. Grafts the user's real Chrome cookies into persist:portal
  // so a freshly-cleared dev session lands logged-in on job portals (+ Google
  // SSO). Makeshift trigger for the production-bound chrome-import/ engine;
  // removed when the production onboarding/consent flow ships. Clearing cookies
  // is a script (scripts/clear-cookies.sh), not in-app — no production analog.
  // See workstreams/browser/cookie-import.md.
  DEV_IMPORT_COOKIES = 'dev:import-cookies',
}

// Configuration
export interface ConfigGetResponse {
  config: AppConfig;
}

export interface ConfigSetRequest {
  config: Partial<AppConfig>;
}

// Authentication
export interface AuthSendTokenRequest {
  token: string | null;
}
