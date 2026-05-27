import { BrowserView, BrowserWindow, session as electronSession } from 'electron';
import * as path from 'path';
import log from './logger';
import { getConfigValue } from './config';
import { IpcChannel } from '../types/ipc.types';

// Cap for live browser-agent job sessions (one viewA per in-flight
// browser_jobs row, plus optional viewB for tailor). Must match
// `MAX_CONCURRENT_BROWSER_JOBS` on the `web-api` side — see
// `workstreams/browser/contracts.md` C9. System sessions (ids prefixed
// with `__`, for example `__webapp__` and `__inbox_<id>__`) are
// long-lived ambient shells for sidebar nav and are EXCLUDED from this
// cap so adding a new sidebar item can never shrink the job budget.
const MAX_BROWSER_JOB_SESSIONS = 15;
const NAVIGATE_TIMEOUT_MS = 30_000;
const PORTAL_PARTITION = 'persist:portal';
const INBOX_SESSION_PREFIX = '__inbox_';
const INBOX_SESSION_SUFFIX = '__';
const INBOX_PARTITION_PREFIX = 'persist:inbox_';

function isSystemSessionId(id: string): boolean {
  return id.startsWith('__');
}

function isInboxSessionId(id: string): boolean {
  // `__inbox_<8-char-id>__` shape - see workstreams/browser/contracts.md C12.
  // Both sides MUST compute the partition / session id identically; the
  // server uses `inbox_session_id(uuid)` in email_agent.py.
  return (
    id.startsWith(INBOX_SESSION_PREFIX) &&
    id.endsWith(INBOX_SESSION_SUFFIX) &&
    id.length === INBOX_SESSION_PREFIX.length + 8 + INBOX_SESSION_SUFFIX.length
  );
}

function inboxShortIdFromSession(id: string): string {
  // Caller guarantees `isInboxSessionId(id)`.
  return id.slice(INBOX_SESSION_PREFIX.length, INBOX_SESSION_PREFIX.length + 8);
}

function partitionForSession(id: string): string {
  if (isInboxSessionId(id)) return INBOX_PARTITION_PREFIX + inboxShortIdFromSession(id);
  return PORTAL_PARTITION;
}

// Memoised Session references per partition. Electron's
// `session.fromPartition` is documented as returning the same instance
// for the same partition string, but caching keeps the call hot-path
// allocation-free.
const partitionCache = new Map<string, Electron.Session>();

function sessionForPartition(partition: string): Electron.Session {
  let s = partitionCache.get(partition);
  if (!s) {
    s = electronSession.fromPartition(partition);
    partitionCache.set(partition, s);
  }
  return s;
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

// When the selected session has no BrowserView — a queued job the worker
// hasn't navigated, or a job from an earlier app run — every BrowserView
// is detached so the renderer's middle panel (the SessionPlaceholder
// card) shows through. `reorderViews` short-circuits in this mode.
let placeholderMode = false;

const sessions = new Map<string, Session>();

// ── Helpers ──────────────────────────────────────────────────────────

function makeView(preloadName: string, partition: string = PORTAL_PARTITION): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, `../preload/${preloadName}.js`),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: sessionForPartition(partition),
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

  // Remove all views first.
  for (const [, session] of sessions) {
    parentWindow.removeBrowserView(session.viewA);
    if (session.viewB) parentWindow.removeBrowserView(session.viewB);
  }

  // Placeholder mode: leave every view detached so the renderer's middle
  // panel (the SessionPlaceholder card) is visible underneath.
  if (placeholderMode) return;

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
  // Electron adds an internal 'closed' listener per attached BrowserView.
  // Steady-state is `MAX_BROWSER_JOB_SESSIONS * 2` (viewA + viewB tailor per
  // session) plus sidebar/system views such as `__webapp__` and connected
  // inboxes. Default limit (10) triggers a noisy warning past that.
  // Derive the ceiling from the cap so vertical-scaling cap raises (see
  // `workstreams/browser/architecture.md` "Scaling Posture") never need
  // a manual revisit here. +20 buffer covers system views and any small
  // accounting drift in Electron's internal listener bookkeeping.
  window.setMaxListeners(MAX_BROWSER_JOB_SESSIONS * 2 + 20);
}

export function createSession(sessionId: string): boolean {
  if (sessions.has(sessionId)) {
    log.debug(`[Panels] createSession(${sessionId.slice(0, 8)}) — already exists`);
    return true;
  }
  if (!isSystemSessionId(sessionId) && countJobSessions() >= MAX_BROWSER_JOB_SESSIONS) {
    log.warn(`[Panels] createSession(${sessionId.slice(0, 8)}) — CAP REACHED (${countJobSessions()}/${MAX_BROWSER_JOB_SESSIONS} job sessions)`);
    return false;
  }
  if (!parentWindow) {
    log.error(`[Panels] createSession(${sessionId.slice(0, 8)}) — no parentWindow`);
    return false;
  }

  const partition = partitionForSession(sessionId);
  const viewA = makeView('preload-webview', partition);
  parentWindow.addBrowserView(viewA);
  applyBounds(viewA);

  sessions.set(sessionId, { viewA, viewB: null, tabId: null });
  log.info(
    `[Panels] createSession(${sessionId.slice(0, 12)}) — created | partition=${partition} ` +
    `| total=${sessions.size} | jobs=${countJobSessions()}/${MAX_BROWSER_JOB_SESSIONS}`,
  );
  return true;
}

function countJobSessions(): number {
  let n = 0;
  for (const id of sessions.keys()) {
    if (!isSystemSessionId(id)) n++;
  }
  return n;
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function showSession(sessionId: string): boolean {
  if (!sessions.has(sessionId)) {
    // No BrowserView for this session — a queued job the worker hasn't
    // navigated yet, or a job from an earlier app run. Detach every view
    // and report `false` so the renderer shows the SessionPlaceholder card.
    log.info(`[Panels] showSession(${sessionId.slice(0, 8)}) — no view, placeholder mode`);
    placeholderMode = true;
    activeSessionId = null;
    reorderViews();
    return false;
  }
  const prev = activeSessionId;
  placeholderMode = false;
  activeSessionId = sessionId;
  reorderViews();
  log.info(`[Panels] showSession(${sessionId.slice(0, 8)}) — prev=${prev?.slice(0, 8) ?? 'none'}`);

  // Push the active-session change to the renderer so the sidebar row
  // gets the active pill even when the worker auto-jumps (i.e. `showSession`
  // was triggered by an incoming `navigate` WS command, not a user click).
  // Idempotent on the renderer side — if `activeJobId` already matches the
  // setState is a no-op.
  //
  // Boot-race note: the very first `showSession` (for `__webapp__`) fires
  // synchronously from `windows.ts:createMainWindow` after `loadURL`
  // resolves, but BEFORE App.tsx mounts and registers its listener. That
  // first push is dropped — harmless because App.tsx initializes
  // `activeNavId='__webapp__'` to match. Don't add an ack/replay here
  // unless we discover a sync gap that actually affects the user.
  if (parentWindow && !parentWindow.isDestroyed() && !parentWindow.webContents.isDestroyed()) {
    try {
      parentWindow.webContents.send(IpcChannel.SESSION_ACTIVE_CHANGED, { sessionId });
    } catch (e) {
      log.warn(`[Panels] session:active-changed send failed: ${(e as Error).message}`);
    }
  }
  return true;
}

/**
 * Create + load a session's viewA. Two modes:
 *   - autoShow: true  (default) — bring the session to the front after load.
 *                                 Used for user-initiated nav: the initial
 *                                 __webapp__ load on app start, and sidebar
 *                                 system-tab clicks routed through
 *                                 showOrNavigateSession.
 *   - autoShow: false           — load in the background. The view is created,
 *                                 the URL is loaded, CDP is attached — but the
 *                                 view is NOT brought to the front. Used by
 *                                 the WS `navigate` action so the worker can
 *                                 start a session without yanking the user's
 *                                 active tab. The user sees the new row in
 *                                 the sidebar (purple gleam) and clicks in
 *                                 when ready.
 *
 * CDP works on hidden BrowserViews — it attaches to webContents, not visual
 * state — so the agent can fully operate against a background-loaded view.
 */
export async function navigateSession(
  sessionId: string,
  url: string,
  options: { autoShow?: boolean } = {},
): Promise<number> {
  const { autoShow = true } = options;
  log.info(`[Panels] navigateSession(${sessionId.slice(0, 8)}) — url: ${url}, autoShow: ${autoShow}`);
  let session = sessions.get(sessionId);

  // Tab-switch semantics: if this session already hosts the target origin,
  // just bring it to the front. Reloading would discard form state, scroll
  // position, and force the webapp's Supabase client to re-hydrate — which
  // in turn fires a cascade of AUTH_SEND_TOKEN pushes and (for viewB) would
  // tear down the TailorPage mid-interaction. Only callers legitimately
  // wanting a reload should do so by destroying the session first.
  if (session && session.tabId !== null) {
    try {
      const currentUrl = session.viewA.webContents.getURL();
      if (currentUrl && new URL(currentUrl).origin === new URL(url).origin) {
        log.info(`[Panels] navigateSession(${sessionId.slice(0, 8)}) — origin match, skipping reload`);
        if (autoShow) showSession(sessionId);
        return session.tabId;
      }
    } catch (err) {
      log.warn(`[Panels] navigateSession(${sessionId.slice(0, 8)}) — URL parse failed, falling through to full navigate: ${(err as Error).message}`);
    }
  }

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

  if (autoShow) {
    showSession(sessionId);
  }

  return session.tabId;
}

/**
 * Switch to a sidebar session: show it if it already exists, else
 * create + load it. The sidebar nav (webapp / Gmail / Outlook) routes
 * through here.
 *
 * Switching to an already-open tab is a pure z-order change — it must
 * NOT reload. `navigateSession` re-runs `loadURL`, which re-walks the
 * page's redirect chain (Gmail → sign-in, Outlook → www.microsoft.com)
 * and costs a visible ~0.3-0.4s on every click. `showSession` is instant
 * and preserves the tab's state (scroll position, sign-in, drafts).
 */
export async function showOrNavigateSession(sessionId: string, url: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (session && session.tabId !== null) {
    log.info(`[Panels] showOrNavigateSession(${sessionId.slice(0, 8)}) — existing tab, z-order switch`);
    showSession(sessionId);
    return;
  }
  await navigateSession(sessionId, url);
}

/**
 * Inbox-specific "show or navigate". A missing url means "normal sidebar
 * row click": show an existing inbox tab without reload, or create it at
 * Gmail root if it does not exist yet. An explicit url means "pre-search
 * affordance": force-load the Gmail search URL even when the session already
 * exists. See workstreams/browser/shell/inbox-access.md "Pre-search affordance".
 */
export async function showOrNavigateInbox(sessionId: string, url?: string): Promise<void> {
  if (!isInboxSessionId(sessionId)) {
    log.warn(`[Panels] showOrNavigateInbox(${sessionId.slice(0, 12)}) — non-inbox session id rejected`);
    return;
  }
  const existing = sessions.get(sessionId);
  if (existing && existing.tabId !== null) {
    if (!url) {
      log.info(`[Panels] showOrNavigateInbox(${sessionId.slice(0, 12)}) — existing tab, z-order switch`);
      showSession(sessionId);
      return;
    }
    log.info(`[Panels] showOrNavigateInbox(${sessionId.slice(0, 12)}) — existing tab, force-loadURL`);
    try {
      await existing.viewA.webContents.loadURL(url);
    } catch (err) {
      log.error(`[Panels] showOrNavigateInbox loadURL failed: ${(err as Error).message}`);
    }
    showSession(sessionId);
    return;
  }
  // No view yet - createSession picks up the per-inbox partition from
  // the session id and navigateSession brings the new view to the front
  // (default autoShow:true).
  await navigateSession(sessionId, url || 'https://mail.google.com/mail/u/0/');
}

export function showTailorView(sessionId: string, url: string): boolean {
  log.info(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — url: ${url}`);
  const session = sessions.get(sessionId);
  if (!session || !parentWindow) {
    log.warn(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — session missing (${!!session}) or no parentWindow (${!!parentWindow})`);
    return false;
  }

  if (!session.viewB) {
    // Derive viewB's partition from the session id so an inbox session's
    // tailor view (should never happen today, but defense-in-depth) would
    // share the inbox's cookie partition, not silently fall back to
    // `persist:portal`. Browser-job sessions resolve to `persist:portal`
    // exactly as before.
    const partition = partitionForSession(sessionId);
    log.info(`[Panels] showTailorView(${sessionId.slice(0, 12)}) — creating viewB | partition=${partition}`);
    session.viewB = makeView('preload-webview', partition);
    parentWindow.addBrowserView(session.viewB);
  } else {
    log.debug(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — viewB exists, reusing`);
  }

  session.viewB.webContents.loadURL(url).catch((err) => {
    log.error(`[Panels] showTailorView(${sessionId.slice(0, 8)}) — loadURL failed: ${err}`);
  });

  // The tailor step is an approval/intervention moment, so surface it: the user
  // should see JorbHeader + the cover-letter stream, not have viewB sit in the
  // background until they click the amber sidebar row. showSession activates the
  // session and reorders viewB on top (and fires session:active-changed so the
  // sidebar pill follows). Multi-session trade-off: this foregrounds a backgrounded
  // job when it needs approval; refine here if it ever competes with a session the
  // user is actively watching.
  showSession(sessionId);

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
  // Capacity is measured in browser-job sessions only. System sessions
  // (sidebar nav views) do not compete for the worker-matched budget.
  return countJobSessions() >= MAX_BROWSER_JOB_SESSIONS;
}
