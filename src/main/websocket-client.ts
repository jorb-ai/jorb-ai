import WebSocket from 'ws';
import log, { tokenPrefix } from './logger';
import { getConfigValue } from './config';
import {
  navigateSession,
  getSessionView,
  showTailorView,
  showPortalView,
} from './panels';
import * as FileSync from './file-sync';

let ws: WebSocket | null = null;
let currentToken: string | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;

const RECONNECT_DELAY = 5000;
const NORMAL_CLOSURE = 1000;

// ── RPC bridge hooks (Spec 4.3) ──────────────────────────────────────
// The renderer's rpc.ts module owns its own request/response correlation
// but does not hold the WS directly — the main process does. These two
// exports give rpc-bridge.ts the minimum surface it needs.

type ServerMessageListener = (msg: unknown) => void;
const serverMessageListeners: Set<ServerMessageListener> = new Set();

export function sendWsMessage(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    const t = (msg as { type?: string } | null)?.type ?? '<unknown>';
    log.warn(`[WebSocket] sendWsMessage — WS not open, message dropped: ${t}`);
  }
}

export function onWsServerMessage(listener: ServerMessageListener): () => void {
  serverMessageListeners.add(listener);
  return () => { serverMessageListeners.delete(listener); };
}

export function connectWebSocket(token: string): void {
  log.info(`[WebSocket] connectWebSocket entry — incoming: ${tokenPrefix(token)}, stored: ${tokenPrefix(currentToken)}`);

  // IF ALREADY CONNECTED, DO NOT CHURN THE OPEN CONNECTION.
  // The server's JWT check runs ONLY at registration, so the already-open WS
  // is still valid even if the server token has since refreshed. We must not
  // tear down a healthy connection just because a new token arrived.
  //
  // BUT: we MUST update the stored `currentToken` so that if the WS later
  // closes and the reconnect handler fires, it reconnects with a fresh token
  // instead of the stale one that was valid at register time. Not updating
  // here caused latent "Invalid token" reconnect failures after the webapp
  // refreshed its session — see the PHASE4 debug logs.
  //
  // APPROVED BY OWNER: only the stored-token update is new here. The original
  // "don't churn open connection" invariant is preserved.
  if (ws && ws.readyState === WebSocket.OPEN) {
    const tokensMatch = token === currentToken;
    log.warn(`[WebSocket] SKIP already-connected — tokens_match: ${tokensMatch}, connection preserved`);
    if (!tokensMatch) {
      log.info(`[WebSocket] Updating stored token in-place — old: ${tokenPrefix(currentToken)}, new: ${tokenPrefix(token)} (open WS unchanged, reconnect will use new token)`);
      currentToken = token;
    }
    return;
  }

  currentToken = token;
  const wsUrl = getConfigValue('automationServerUrl');
  log.info(`[WebSocket] Opening connection — url: ${wsUrl}, token: ${tokenPrefix(token)}`);

  try {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      log.info(`[WebSocket] Connection open — sending register, token: ${tokenPrefix(currentToken)}`);
      ws!.send(JSON.stringify({ type: 'register', token: currentToken }));
      FileSync.setWebSocket(ws!);
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        handleServerMessage(JSON.parse(data.toString()));
      } catch (error) {
        log.error('[WebSocket] Failed to parse message:', error);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() || '<empty>';
      log.warn(`[WebSocket] Closed — code: ${code}, reason: "${reasonStr}", stored token: ${tokenPrefix(currentToken)}`);
      if (currentToken && code !== NORMAL_CLOSURE) {
        log.info(`[WebSocket] Scheduling reconnect in ${RECONNECT_DELAY}ms with stored token`);
        reconnectTimeout = setTimeout(() => {
          if (currentToken) connectWebSocket(currentToken);
        }, RECONNECT_DELAY);
      }
    });

    ws.on('error', (error: Error) => {
      log.error('[WebSocket] Error:', error.message);
    });
  } catch (error) {
    log.error('[WebSocket] Failed to connect:', error);
  }
}

function handleServerMessage(message: any): void {
  // Fan out to RPC listeners BEFORE the existing dispatch. Listeners only
  // care about data-plane messages (browser_jobs_list, agent_job,
  // *_inserted / *_updated, subscribed, error-correlated-to-an-id); the
  // main-process dispatch below handles CDP/navigate/file-sync/panel-
  // switch. Each side ignores the messages it does not own.
  for (const listener of serverMessageListeners) {
    try {
      listener(message);
    } catch (e) {
      log.error('[WebSocket] RPC listener error:', e);
    }
  }

  // Registration confirmation
  if (message.type === 'registered') {
    log.info(`[WebSocket] Registered — user: ${message.user_id}`);
    FileSync.requestFileSync();
    return;
  }

  if (message.type === 'pong') return;

  if (message.type === 'error') {
    log.error(`[WebSocket] SERVER ERROR — ${JSON.stringify(message)}`);
    return;
  }

  // File sync messages
  if (message.type === 'file_sync_metadata') {
    log.debug(`[WebSocket] file_sync_metadata — count: ${message.files?.length ?? 0}`);
    FileSync.handleSyncMetadata(message.files);
    return;
  }
  if (message.type === 'signed_urls') {
    log.debug(`[WebSocket] signed_urls — count: ${message.files?.length ?? 0}`);
    FileSync.handleSignedUrls(message.files);
    return;
  }
  if (message.type === 'file_sync_acknowledged') {
    return;
  }
  // Triggered by tailor.py after PDF upload — re-sync files
  if (message.type === 'file_sync_trigger') {
    log.info(`[WebSocket] file_sync_trigger — file_id: ${message.file_id}`);
    FileSync.requestFileSync();
    return;
  }

  // Panel switch (Phase 3.2) — swap between portal and tailor views
  if (message.type === 'panel_switch') {
    const { session_id, target, url } = message;
    log.info(`[WebSocket] panel_switch — session: ${session_id?.slice(0, 8) ?? '?'}, target: ${target}, url: ${url ?? '<none>'}`);
    if (target === 'webapp' && session_id && url) {
      const ok = showTailorView(session_id, url);
      log.info(`[WebSocket] panel_switch → webapp result: ${ok}`);
    } else if (target === 'portal' && session_id) {
      const ok = showPortalView(session_id);
      log.info(`[WebSocket] panel_switch → portal result: ${ok}`);
    } else {
      log.warn(`[WebSocket] panel_switch — invalid params (session: ${!!session_id}, target: ${target}, url: ${!!url})`);
    }
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
      log.warn(`[WebSocket] Unknown action: ${action}`);
      sendError(id, `Unknown action: ${action}`);
  }
}

async function executeNavigate(id: string, params: any): Promise<void> {
  const { url, session_id } = params || {};
  if (!url || !session_id) {
    sendError(id, 'Missing required parameters: url, session_id');
    return;
  }

  try {
    const tabId = await navigateSession(session_id, url);
    log.info('[WebSocket] Navigated:', session_id.slice(0, 8), '→', url, '— tab_id:', tabId);
    sendResult(id, { tab_id: tabId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Navigation failed';
    log.error('[WebSocket] Navigate failed:', msg);
    sendError(id, msg);
  }
}

async function executeCdpCommand(id: string, params: any): Promise<void> {
  const { method, args, session_id } = params;

  if (!method || !session_id) {
    sendError(id, 'Missing required parameters: method, session_id');
    return;
  }

  try {
    const view = getSessionView(session_id);
    if (!view) {
      sendError(id, `No BrowserView for session ${session_id.slice(0, 8)}`);
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
    log.error('[WebSocket] CDP failed:', msg);
    sendError(id, msg);
  }
}

async function executeFileUpload(id: string, params: any): Promise<void> {
  const { relative_path, cdp_method, cdp_args, session_id } = params;

  if (!relative_path || !cdp_method || !session_id) {
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
      session_id,
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
    log.info('[WebSocket] Sent stop for job:', jobId);
  }
}

export function disconnectWebSocket(): void {
  const state = ws ? ws.readyState : 'null';
  log.warn(`[WebSocket] disconnectWebSocket called — ws state: ${state}, stored: ${tokenPrefix(currentToken)}`);
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (!ws) return;
  log.info('[WebSocket] Closing — reason: User logged out');
  currentToken = null;
  ws.close(NORMAL_CLOSURE, 'User logged out');
  ws = null;
}

export function isWebSocketConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
