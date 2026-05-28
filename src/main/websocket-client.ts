import WebSocket from 'ws';
import log from './logger';
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

// Messages sent before the WS is open get queued here and flushed after
// register in the 'open' handler. Without this, a renderer-initiated
// request (list_browser_jobs, subscribe, ...) that fires in the narrow
// window between ipc handler registration and the WS handshake completing
// was silently dropped — user-visible as a ~10s sidebar populate delay
// on every cold start while rpc.ts's request timeout ran out.
const sendQueue: unknown[] = [];

// Whether the renderer has requested a live pubsub subscription. Kept on
// the main side so that after any reconnect (WS died mid-session, token
// refresh that triggered teardown), we automatically re-send `subscribe`
// without requiring the renderer to notice the WS lifecycle. The server
// forgets subscriptions on disconnect, so without this the renderer
// silently stops receiving browser_job_inserted/updated after any blip.
let hasSubscribed = false;

function shouldRetainAcrossReconnect(msg: unknown): boolean {
  const type = (msg as { type?: string } | null)?.type;
  return type === 'stop_automation' || type === 'user_continued';
}

export function sendWsMessage(msg: unknown): void {
  const t = (msg as { type?: string } | null)?.type;
  if (t === 'subscribe') hasSubscribed = true;
  else if (t === 'unsubscribe') hasSubscribed = false;

  const isOpen = ws && ws.readyState === WebSocket.OPEN;
  // Log the high-signal message types at info so they appear in the
  // shipped log file. CDP responses and other high-volume types stay
  // silent here; their telemetry happens elsewhere.
  if (t === 'subscribe' || t === 'unsubscribe' || t === 'list_browser_jobs' || t === 'watch_agent_job') {
    log.info(`[WebSocket] sendWsMessage(${t}) — ${isOpen ? 'sent' : 'queued'}`);
  }

  if (isOpen) {
    ws!.send(JSON.stringify(msg));
  } else {
    log.debug(`[WebSocket] sendWsMessage — WS not open, queuing: ${t ?? '<unknown>'}`);
    sendQueue.push(msg);
  }
}

export function onWsServerMessage(listener: ServerMessageListener): () => void {
  serverMessageListeners.add(listener);
  return () => { serverMessageListeners.delete(listener); };
}

export function connectWebSocket(token: string): void {
  log.info(`[WebSocket] connectWebSocket entry: hasStoredToken=${!!currentToken}`);

  // IF ALREADY CONNECTED OR HANDSHAKING, DO NOT OPEN A SECOND WS.
  //
  // OPEN: the server's JWT check runs ONLY at registration, so the already-
  // open WS is still valid even if the token has since refreshed. Tearing it
  // down on every auth state change would churn the connection.
  //
  // CONNECTING: the webapp's `electron-auth-bridge` can fire `sendAuthToken`
  // twice within a few ms during initial hydration (e.g. INITIAL_SESSION
  // followed immediately by a visibility-driven refresh). The first call
  // opens WS1; the second arrives while WS1 is still in CONNECTING state.
  // Without this gate the second call falls through and runs `ws = new
  // WebSocket(...)`, clobbering the ref. WS1's `open` handler then fires
  // and tries `ws!.send(register)` — but `ws` now points to WS2 which is
  // also CONNECTING — and crashes with `WebSocket is not open: readyState 0`.
  //
  // We MUST update the stored `currentToken` either way so the reconnect
  // path uses the freshest token rather than the one valid at register time.
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    const tokensMatch = token === currentToken;
    const stateLabel = ws.readyState === WebSocket.CONNECTING ? 'connecting' : 'open';
    log.warn(`[WebSocket] SKIP already-${stateLabel} — tokens_match: ${tokensMatch}, connection preserved`);
    if (!tokensMatch) {
      log.info('[WebSocket] Updating stored token in place (existing WS unchanged, reconnect will use new token)');
      currentToken = token;
    }
    return;
  }

  currentToken = token;
  const wsUrl = getConfigValue('automationServerUrl');
  log.info(`[WebSocket] Opening connection: url=${wsUrl}`);

  try {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      log.info('[WebSocket] Connection open: sending register');
      ws!.send(JSON.stringify({ type: 'register', token: currentToken }));
      FileSync.setWebSocket(ws!);

      // Flush anything queued before the handshake completed. Register
      // goes first so the server processes these against a registered
      // session; WS ordering is FIFO on a single connection.
      let flushed = 0;
      while (sendQueue.length > 0) {
        const queued = sendQueue.shift();
        try {
          ws!.send(JSON.stringify(queued));
          flushed++;
        } catch (e) {
          log.warn('[WebSocket] flush failed:', e);
        }
      }
      if (flushed > 0) {
        log.info(`[WebSocket] Flushed ${flushed} queued message(s) after open`);
      }

      // Auto-resubscribe on every open if the renderer has ever asked
      // for a subscription. Handles the reconnect case — server forgets
      // subscriptions on disconnect. Idempotent on the server side (the
      // subscribe handler just re-adds this WS to the user's set).
      if (hasSubscribed) {
        log.info('[WebSocket] Auto-resubscribing (renderer previously requested)');
        ws!.send(JSON.stringify({ type: 'subscribe' }));
      }
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
      log.warn(`[WebSocket] Closed: code=${code}, reason="${reasonStr}", hasStoredToken=${!!currentToken}`);
      // Drop request/response queue entries for the dead connection. The
      // renderer's rpc.ts owns the 10s request timeout; any pending correlated
      // response will surface as a rejection there. Stop and Continue are
      // user safety/resume actions and should land after reconnect if possible.
      if (sendQueue.length > 0) {
        const retained = sendQueue.filter(shouldRetainAcrossReconnect);
        const dropped = sendQueue.length - retained.length;
        sendQueue.length = 0;
        sendQueue.push(...retained);
        log.info(`[WebSocket] Dropping ${dropped} queued message(s) on close, retaining ${retained.length}`);
      }
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
    return;
  }

  if (message.type === 'pong') return;

  if (message.type === 'error') {
    log.error(`[WebSocket] SERVER ERROR — ${JSON.stringify(message)}`);
    return;
  }

  // File sync: single-round-trip trigger from tailor.py. Payload carries
  // the signed URL inline; the desktop downloads, writes to
  // files/{file_id}/{file_name}, and acks. No metadata listing, no
  // separate signed-URL request.
  if (message.type === 'file_sync_trigger') {
    log.info(`[WebSocket] file_sync_trigger — file_id: ${message.file_id}`);
    FileSync.handleSyncTrigger({
      file_id: message.file_id,
      file_name: message.file_name,
      signed_url: message.signed_url,
    });
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
    // Worker-driven navigate: load in the BACKGROUND. The agent needs viewA
    // created + URL loaded + CDP attached (all of which still happen), but we
    // do NOT bring it to the front — that would yank the user's active tab
    // away from wherever they are. The sidebar's WS pubsub push shows the
    // new row with a purple gleam; the user clicks in when they want to
    // watch. See `panels.ts:navigateSession` autoShow doc.
    const tabId = await navigateSession(session_id, url, { autoShow: false });
    log.info('[WebSocket] Navigated:', session_id.slice(0, 8), '→', url, '— tab_id:', tabId, '(background)');
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
  const isOpen = ws && ws.readyState === WebSocket.OPEN;
  sendWsMessage({ type: 'stop_automation', job_id: jobId });
  log.info(`[WebSocket] ${isOpen ? 'Sent' : 'Queued'} stop for job: ${jobId}`);
}

/**
 * Inbox-access: user clicked Continue in the action bar after a
 * `paused_for_user` event. The server resolves the matching
 * PENDING_OTP_REQUESTS entry with `{kind: 'user_continued'}`; the apply
 * agent re-reads viewA's DOM and proceeds. See contracts.md C13.
 */
export function sendUserContinued(jobId: string): void {
  const isOpen = ws && ws.readyState === WebSocket.OPEN;
  sendWsMessage({ type: 'user_continued', job_id: jobId });
  log.info(`[WebSocket] ${isOpen ? 'Sent' : 'Queued'} user_continued for job: ${jobId}`);
}

export function disconnectWebSocket(): void {
  const state = ws ? ws.readyState : 'null';
  log.warn(`[WebSocket] disconnectWebSocket called: ws state=${state}, hasStoredToken=${!!currentToken}`);
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (!ws) return;
  log.info('[WebSocket] Closing — reason: User logged out');
  currentToken = null;
  // Hard reset queue + subscription state so the next login starts clean.
  sendQueue.length = 0;
  hasSubscribed = false;
  ws.close(NORMAL_CLOSURE, 'User logged out');
  ws = null;
}

export function isWebSocketConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
