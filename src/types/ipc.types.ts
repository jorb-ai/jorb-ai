import { AppConfig } from './config.types';

export enum IpcChannel {
  // Configuration
  CONFIG_GET = 'config:get',
  CONFIG_SET = 'config:set',

  // Authentication
  AUTH_SEND_TOKEN = 'auth:send-token',
  AUTH_TOKEN_CHANGED = 'auth:token-changed',

  // Session lifecycle (Phase 3)
  SESSION_SHOW = 'session:show',
  SESSION_SHOW_TAILOR = 'session:show-tailor',
  SESSION_DESTROY = 'session:destroy',
  SESSION_STATUS = 'session:status',

  // Browser panel (legacy — kept for web app nav)
  PANEL_NAVIGATE = 'panel:navigate',
  PANEL_GET_TAB_ID = 'panel:get-tab-id',
  PANEL_RESIZE = 'panel:resize',

  // Browser automation
  BROWSER_STOP = 'browser:stop',

  // Spec 4.3 — WS-backed RPC surface
  RPC_REQUEST = 'rpc:request',
  RPC_SUBSCRIBE = 'rpc:subscribe',
  RPC_UNSUBSCRIBE = 'rpc:unsubscribe',
  RPC_EVENT = 'rpc:event',
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
