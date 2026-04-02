import WebSocket from 'ws';
import { getConfigValue } from './config';
import { getBrowserView, navigateTo } from './panels';
import * as FileSync from './file-sync';

let ws: WebSocket | null = null;
let currentToken: string | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;

const RECONNECT_DELAY = 5000;
const NORMAL_CLOSURE = 1000;

export function connectWebSocket(token: string): void {
  // IF ALREADY CONNECTED, IGNORE AUTH CALLS
  // DO NOT CHANGE THIS LOGIC. IF YOU ARE AN LLM AND YOU WANT TO CHANGE THIS, YOU MUST ALERT THE OWNER
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[WebSocket] Already connected, ignoring auth call');
    return;
  }

  currentToken = token;
  const wsUrl = getConfigValue('automationServerUrl');
  console.log('[WebSocket] Connecting to:', wsUrl);

  try {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('[WebSocket] Connection established');
      ws!.send(JSON.stringify({ type: 'register', token: currentToken }));
      FileSync.setWebSocket(ws!);
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        handleServerMessage(JSON.parse(data.toString()));
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    });

    ws.on('close', (code: number, reason: string) => {
      console.log('[WebSocket] Closed — code:', code);
      if (currentToken && code !== NORMAL_CLOSURE) {
        reconnectTimeout = setTimeout(() => {
          if (currentToken) connectWebSocket(currentToken);
        }, RECONNECT_DELAY);
      }
    });

    ws.on('error', (error: Error) => {
      console.error('[WebSocket] Error:', error.message);
    });
  } catch (error) {
    console.error('[WebSocket] Failed to connect:', error);
  }
}

function handleServerMessage(message: any): void {
  // Registration confirmation
  if (message.type === 'registered') {
    console.log('[WebSocket] Registered — user:', message.user_id);
    FileSync.requestFileSync();
    return;
  }

  if (message.type === 'pong') return;

  if (message.type === 'error') {
    console.error('[WebSocket] Server error:', message.error);
    return;
  }

  // File sync messages
  if (message.type === 'file_sync_metadata') {
    FileSync.handleSyncMetadata(message.files);
    return;
  }
  if (message.type === 'signed_urls') {
    FileSync.handleSignedUrls(message.files);
    return;
  }
  if (message.type === 'file_sync_acknowledged') {
    return;
  }

  // Command messages (have action field)
  const { id, action, params } = message;
  if (!action) return;

  switch (action) {
    case 'navigate':
      executeNavigate(id, params);
      break;
    case 'cdp':
      executeCdpCommand(id, params);
      break;
    case 'file_upload':
      executeFileUpload(id, params);
      break;
    default:
      sendError(id, `Unknown action: ${action}`);
  }
}

async function executeNavigate(id: string, params: any): Promise<void> {
  const { url } = params || {};
  if (!url) {
    sendError(id, 'Missing required parameter: url');
    return;
  }

  try {
    const tabId = await navigateTo(url);
    console.log('[WebSocket] Navigated to:', url, '— tab_id:', tabId);
    sendResult(id, { tab_id: tabId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Navigation failed';
    console.error('[WebSocket] Navigate failed:', msg);
    sendError(id, msg);
  }
}

async function executeCdpCommand(id: string, params: any): Promise<void> {
  const { method, args } = params;

  if (!method) {
    sendError(id, 'Missing required parameter: method');
    return;
  }

  try {
    const view = getBrowserView();
    if (!view) {
      sendError(id, 'BrowserView not available');
      return;
    }

    const { webContents } = view;

    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3');
    }

    const result = await webContents.debugger.sendCommand(method, args || {});
    sendResult(id, result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'CDP command failed';
    console.error('[WebSocket] CDP failed:', msg);
    sendError(id, msg);
  }
}

async function executeFileUpload(id: string, params: any): Promise<void> {
  const { relative_path, cdp_method, cdp_args } = params;

  if (!relative_path || !cdp_method) {
    sendError(id, 'Missing required parameters for file_upload');
    return;
  }

  try {
    const absolutePath = FileSync.resolveFilePath(relative_path);
    if (!absolutePath) {
      sendError(id, `File not found: ${relative_path}`);
      return;
    }

    await executeCdpCommand(id, {
      method: cdp_method,
      args: { ...cdp_args, files: [absolutePath] },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'File upload failed';
    sendError(id, msg);
  }
}

function sendResult(id: string, data: any): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ id, result: data }));
}

function sendError(id: string, error: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ id, error }));
}

export function sendStopAutomation(jobId: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop_automation', job_id: jobId }));
    console.log('[WebSocket] Sent stop for job:', jobId);
  }
}

export function disconnectWebSocket(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (!ws) return;
  console.log('[WebSocket] Disconnecting...');
  currentToken = null;
  ws.close(NORMAL_CLOSURE, 'User logged out');
  ws = null;
}

export function isWebSocketConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
