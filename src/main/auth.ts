import { BrowserWindow } from 'electron';
import log, { tokenPrefix } from './logger';
import { connectWebSocket, disconnectWebSocket } from './websocket-client';

let currentToken: string | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindowRef(window: BrowserWindow): void {
  mainWindow = window;
}

export function handleAuthToken(token: string | null): void {
  const prevPrefix = tokenPrefix(currentToken);
  const newPrefix = tokenPrefix(token);

  if (token === null) {
    log.warn(`[Auth] NULL TOKEN RECEIVED — previous was ${prevPrefix} — initiating logout sequence`);
    currentToken = null;
    disconnectWebSocket();
    notifyRenderer(null);
    return;
  }

  const isSameAsCurrent = token === currentToken;
  log.info(`[Auth] Token received — prefix: ${newPrefix}, prev: ${prevPrefix}, same: ${isSameAsCurrent}`);
  currentToken = token;
  connectWebSocket(token);
  notifyRenderer(token);
}

function notifyRenderer(token: string | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:token-changed', token);
  }
}

export function getCurrentToken(): string | null {
  return currentToken;
}

export function isAuthenticated(): boolean {
  return currentToken !== null;
}
