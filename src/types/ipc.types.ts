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
  SESSION_SHOW_PLACEHOLDER = 'session:show-placeholder',
  SESSION_DESTROY = 'session:destroy',
  SESSION_STATUS = 'session:status',

  // Middle-panel navigation (system tabs load via navigateSession)
  PANEL_NAVIGATE = 'panel:navigate',
  // Renderer tells main how tall the action bar currently is so
  // BrowserView bounds are computed from the right offset.
  PANEL_SET_BAR_HEIGHT = 'panel:set-bar-height',

  // Browser automation
  BROWSER_STOP = 'browser:stop',

  // WS-backed RPC surface (Spec 4.3)
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
