import { BrowserWindow } from 'electron';
import log from './logger';
import { connectWebSocket, disconnectWebSocket } from './websocket-client';

let currentToken: string | null = null;
let mainWindow: BrowserWindow | null = null;

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
}

export function setMainWindowRef(window: BrowserWindow): void {
  mainWindow = window;
}

export function handleAuthToken(token: string | null): void {
  if (token === null) {
    log.warn('[Auth] NULL TOKEN RECEIVED: initiating logout sequence');
    currentToken = null;
    disconnectWebSocket();
    notifyRenderer({ isAuthenticated: false, userId: null });
    return;
  }

  const isSameAsCurrent = token === currentToken;
  const userId = parseJwtSub(token);
  log.info(`[Auth] Token received: same=${isSameAsCurrent}, user=${userId?.slice(0, 8) ?? 'unknown'}`);
  currentToken = token;
  connectWebSocket(token);
  notifyRenderer({ isAuthenticated: true, userId });
}

function parseJwtSub(token: string): string | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function notifyRenderer(state: AuthState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:token-changed', state);
  }
}

export function getCurrentToken(): string | null {
  return currentToken;
}

export function isAuthenticated(): boolean {
  return currentToken !== null;
}
