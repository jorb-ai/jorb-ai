import { BrowserView, BrowserWindow, session as electronSession } from 'electron';
import * as path from 'path';
import log from './logger';
import { getConfigValue } from './config';

const MAX_SESSIONS = 5;
const NAVIGATE_TIMEOUT_MS = 30_000;
const PORTAL_PARTITION = 'persist:portal';

let portalSession: Electron.Session | null = null;

function getPortalSession(): Electron.Session {
  if (!portalSession) {
    portalSession = electronSession.fromPartition(PORTAL_PARTITION);
  }
  return portalSession;
}

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Session {
  viewA: BrowserView;       // portal — always exists
  viewB: BrowserView | null; // tailor — created on demand
  tabId: number | null;      // webContents.id of viewA (set after first navigate)
}

let parentWindow: BrowserWindow | null = null;
let currentBounds: PanelBounds = { x: 0, y: 0, width: 800, height: 600 };
let activeSessionId: string | null = null;

const sessions = new Map<string, Session>();

// ── Helpers ──────────────────────────────────────────────────────────

function makeView(preloadName: string): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, `../preload/${preloadName}.js`),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: getPortalSession(),
    },
  });

  // Prevent CDP throttling on hidden views
  view.webContents.setBackgroundThrottling(false);

  // Auth is push-only (Phase 4 R20 update): the webapp calls
  // window.finbro.sendAuthToken on SIGNED_IN / TOKEN_REFRESHED /
  // visibilitychange-driven refreshes, exposed by preload-webview.ts.
  // No proactive localStorage read — that was reading 23-hour-stale
  // tokens on every BrowserView load and causing "Invalid token" WS
  // registration failures on every startup.

  view.webContents.on('did-navigate', (_event, url) => {
    log.debug(`[Panels] did-navigate — ${url}`);
  });

  if (getConfigValue('debugMode')) {
    view.webContents.openDevTools({ mode: 'detach' });
  }

  return view;
}

function applyBounds(view: BrowserView): void {
  view.setBounds(currentBounds);
}

function reorderViews(): void {
  if (!parentWindow) return;

  // Remove all views, then re-add: hidden sessions first, active session last (on top).
  for (const [, session] of sessions) {
    parentWindow.removeBrowserView(session.viewA);
    if (session.viewB) parentWindow.removeBrowserView(session.viewB);
  }

  const active = activeSessionId ? sessions.get(activeSessionId) : null;

  // Add hidden sessions first (behind)
  for (const [id, session] of sessions) {
    if (id === activeSessionId) continue;
    parentWindow.addBrowserView(session.viewA);
    applyBounds(session.viewA);
    if (session.viewB) {
      parentWindow.addBrowserView(session.viewB);
      applyBounds(session.viewB);
    }
  }

  // Add active session last (on top)
  if (active) {
    parentWindow.addBrowserView(active.viewA);
    applyBounds(active.viewA);
    if (active.viewB) {
      parentWindow.addBrowserView(active.viewB);
      applyBounds(active.viewB);
    }
  }
}

function teardownView(view: BrowserView): void {
  if (view.webContents.debugger.isAttached()) {
    try { view.webContents.debugger.detach(); } catch {}
  }
  parentWindow?.removeBrowserView(view);
  view.webContents.close();
}

// ── Public API ───────────────────────────────────────────────────────

export function init(window: BrowserWindow, bounds: PanelBounds): void {
  parentWindow = window;
  currentBounds = bounds;
}

export function createSession(sessionId: string): boolean {
  if (sessions.has(sessionId)) {
    log.debug(`[Panels] createSession(${sessionId.slice(0, 8)}) — already exists`);
    return true;
  }
  if (sessions.size >= MAX_SESSIONS) {
    log.warn(`[Panels] createSession(${sessionId.slice(0, 8)}) — CAP REACHED (${sessions.size}/${MAX_SESSIONS})`);
    return false;
  }
  if (!parentWindow) {
    log.error(`[Panels] createSession(${sessionId.slice(0, 8)}) — no parentWindow`);
    return false;
  }

  const viewA = makeView('preload-webview');
  parentWindow.addBrowserView(viewA);
  applyBounds(viewA);

  sessions.set(sessionId, { viewA, viewB: null, tabId: null });
  log.info(`[Panels] createSession(${sessionId.slice(0, 8)}) — created | total=${sessions.size}/${MAX_SESSIONS}`);
  return true;
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function showSession(sessionId: string): boolean {
  if (!sessions.has(sessionId)) {
    log.debug(`[Panels] showSession(${sessionId.slice(0, 8)}) — session not found`);
    return false;
  }
  const prev = activeSessionId;
  activeSessionId = sessionId;
  reorderViews();
  log.info(`[Panels] showSession(${sessionId.slice(0, 8)}) — prev=${prev?.slice(0, 8) ?? 'none'}`);
  return true;
}

export async function navigateSession(sessionId: string, url: string): Promise<number> {
  log.info(`[Panels] navigateSession(${sessionId.slice(0, 8)}) — url: ${url}`);
  let session = sessions.get(sessionId);
  if (!session) {
    const created = createSession(sessionId);
    if (!created) throw new Error('Session cap reached');
    session = sessions.get(sessionId)!;
  }

  // Attach CDP debugger BEFORE loading so we don't miss early page events
  if (!session.viewA.webContents.debugger.isAttached()) {
    try {
      session.viewA.webContents.debugger.attach('1.3');
      log.info(`[Panels] CDP debugger attached: ${sessionId.slice(0, 8)}`);
    } catch (err) {
      log.error(`[Panels] Failed to attach debugger:`, err);
    }
  }

  // Load URL with timeout to prevent infinite hang
  try {
    await Promise.race([
      session.viewA.webContents.loadURL(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Navigation timeout after ${NAVIGATE_TIMEOUT_MS}ms`)), NAVIGATE_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    log.error(`[Panels] navigateSession(${sessionId.slice(0, 8)}) — loadURL failed: ${(err as Error).message}`);
    throw err;
  }

  session.tabId = session.viewA.webContents.id;
  log.info(`[Panels] navigateSession(${sessionId.slice(0, 8)}) — loaded, tabId=${session.tabId}`);

  // Auto-show this session
  showSession(sessionId);

  return session.tabId;
}

export function showTailorView(sessionId: string, url: string): boolean {
  log.info(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — url: ${url}`);
  const session = sessions.get(sessionId);
  if (!session || !parentWindow) {
    log.warn(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — session missing (${!!session}) or no parentWindow (${!!parentWindow})`);
    return false;
  }

  if (!session.viewB) {
    log.info(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — creating viewB`);
    session.viewB = makeView('preload-webview');
    parentWindow.addBrowserView(session.viewB);
  } else {
    log.debug(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — viewB exists, reusing`);
  }

  session.viewB.webContents.loadURL(url).catch((err) => {
    log.error(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — loadURL failed: ${err}`);
  });

  // If this is the active session, reorder so viewB is on top
  if (activeSessionId === sessionId) {
    reorderViews();
  } else {
    log.debug(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — not active (active=${activeSessionId?.slice(0, 8) ?? 'none'}), viewB created in background`);
  }

  return true;
}

export function hasTailorView(sessionId: string): boolean {
  return sessions.get(sessionId)?.viewB != null;
}

export function showPortalView(sessionId: string): boolean {
  log.info(`[Panels] showPortalView(${sessionId.slice(0, 8)}) — entry`);
  const session = sessions.get(sessionId);
  if (!session || !parentWindow) {
    log.warn(`[Panels] showPortalView(${sessionId.slice(0, 8)}) — session missing or no parentWindow`);
    return false;
  }

  if (session.viewB) {
    log.info(`[Panels] showPortalView(${sessionId.slice(0, 8)}) — tearing down viewB`);
    teardownView(session.viewB);
    session.viewB = null;
  }

  if (activeSessionId === sessionId) {
    reorderViews();
  }

  return true;
}

export function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    log.debug(`[Panels] destroySession(${sessionId.slice(0, 8)}) — not found`);
    return;
  }

  log.info(`[Panels] destroySession(${sessionId.slice(0, 8)}) — viewA${session.viewB ? '+viewB' : ''}`);
  teardownView(session.viewA);
  if (session.viewB) {
    teardownView(session.viewB);
  }

  sessions.delete(sessionId);

  if (activeSessionId === sessionId) {
    activeSessionId = null;
  }

  log.info(`[Panels] destroySession(${sessionId.slice(0, 8)}) — done, remaining=${sessions.size}`);
}

export function destroyAll(): void {
  for (const sessionId of [...sessions.keys()]) {
    destroySession(sessionId);
  }
  parentWindow = null;
}

export function getSessionView(sessionId: string): BrowserView | null {
  return sessions.get(sessionId)?.viewA || null;
}

export function layoutBrowserViews(bounds: PanelBounds): void {
  currentBounds = bounds;
  for (const [, session] of sessions) {
    applyBounds(session.viewA);
    if (session.viewB) applyBounds(session.viewB);
  }
}

export function getSessionCount(): number {
  return sessions.size;
}

export function isAtCapacity(): boolean {
  return sessions.size >= MAX_SESSIONS;
}
