import { BrowserWindow } from 'electron';
import { connectWebSocket, disconnectWebSocket } from './websocket-client';

let currentToken: string | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindowRef(window: BrowserWindow): void {
  mainWindow = window;
}

export function handleAuthToken(token: string | null): void {
  if (token === null) {
    console.log('[Auth] Logout — clearing token');
    currentToken = null;
    disconnectWebSocket();
    notifyRenderer(null);
  } else {
    console.log('[Auth] Received JWT');
    currentToken = token;
    connectWebSocket(token);
    notifyRenderer(token);
  }
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
