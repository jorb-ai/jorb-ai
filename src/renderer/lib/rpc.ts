/**
 * Renderer-side data layer (Phase 4 + inbox-access). Talks to the main
 * process over IPC, which forwards over the WebSocket. Does NOT open its
 * own WS - the main process owns the connection.
 *
 * Replaces renderer/lib/supabase.ts. The renderer never imports
 * @supabase/supabase-js; all queries and live updates flow through this
 * module.
 */

import type { BrowserJobRow, UserInbox } from '../types';

// Correlation id → entry used to resolve/reject the caller's Promise and
// cancel the timeout timer. Every request is bounded so a dropped server
// response cannot hang a React effect forever.
interface PendingEntry {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, PendingEntry>();

const jobInsertCallbacks = new Set<(row: BrowserJobRow) => void>();
const jobUpdateCallbacks = new Set<(row: BrowserJobRow) => void>();
// Keyed by agent_job_id → set of per-component update callbacks
const agentJobCallbacks = new Map<string, Set<(row: any) => void>>();

// Inbox-access pushes (C14). One set of (inbox_id, reading) callbacks
// fanned by the useInboxStatus hook into its Map<inbox_id, reading>.
const inboxStatusCallbacks = new Set<(payload: { inbox_id: string; reading: boolean }) => void>();

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ── Event router ─────────────────────────────────────────────────────

window.Finbro.rpc?.onEvent((event: any) => {
  // Correlated response - route to the pending entry by id.
  if (event?.id && pending.has(event.id)) {
    const entry = pending.get(event.id)!;
    pending.delete(event.id);
    clearTimeout(entry.timer);
    if (event.type === 'error') {
      entry.reject(new Error(event.error || 'rpc error'));
    } else {
      entry.resolve(event);
    }
    return;
  }
  // Server-push events (no matching id)
  switch (event?.type) {
    case 'browser_job_inserted':
      console.log(
        `[rpc] browser_job_inserted received - id: ${event.row?.id?.slice(0, 8)}, callbacks: ${jobInsertCallbacks.size}`,
      );
      if (jobInsertCallbacks.size === 0) {
        console.warn('[rpc] browser_job_inserted DROPPED - no callbacks registered');
      }
      jobInsertCallbacks.forEach((cb) => cb(event.row));
      break;
    case 'browser_job_updated':
      console.log(
        `[rpc] browser_job_updated received - id: ${event.row?.id?.slice(0, 8)}, status: ${event.row?.status}, callbacks: ${jobUpdateCallbacks.size}`,
      );
      jobUpdateCallbacks.forEach((cb) => cb(event.row));
      break;
    case 'agent_job_updated': {
      const rowId = event.row?.id;
      if (rowId) {
        agentJobCallbacks.get(rowId)?.forEach((cb) => cb(event.row));
      }
      break;
    }
    case 'inbox_status_changed': {
      const inboxId: string | undefined = event.inbox_id;
      const reading: boolean = Boolean(event.reading);
      if (!inboxId) break;
      console.log(`[rpc] inbox_status_changed - inbox: ${inboxId.slice(0, 8)}, reading: ${reading}`);
      inboxStatusCallbacks.forEach((cb) => cb({ inbox_id: inboxId, reading }));
      break;
    }
    case 'subscribed':
      console.log('[rpc] server confirmed subscription');
      break;
    default:
      break;
  }
});

// ── Internal: correlated request/response over WS ────────────────────

function sendRequest<T = unknown>(
  msg: { type: string; [k: string]: unknown },
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rpc timeout: ${msg.type}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: resolve as (data: unknown) => void,
      reject,
      timer,
    });
    window.Finbro.rpc.request({ id, ...msg }).catch((err: Error) => {
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(err);
      }
    });
  });
}

// ── Browser jobs (existing) ──────────────────────────────────────────

export async function listBrowserJobs(): Promise<BrowserJobRow[]> {
  try {
    const response = await sendRequest<{ rows: BrowserJobRow[] }>({
      type: 'list_browser_jobs',
    });
    return response.rows || [];
  } catch (err) {
    console.error('[rpc] listBrowserJobs failed:', err);
    return [];
  }
}

export function subscribeBrowserJobs(
  onInsert: (row: BrowserJobRow) => void,
  onUpdate: (row: BrowserJobRow) => void,
): () => void {
  jobInsertCallbacks.add(onInsert);
  jobUpdateCallbacks.add(onUpdate);
  console.log(
    `[rpc] subscribeBrowserJobs registered - insertCbs: ${jobInsertCallbacks.size}, updateCbs: ${jobUpdateCallbacks.size}`,
  );
  window.Finbro.rpc.subscribe();
  return () => {
    jobInsertCallbacks.delete(onInsert);
    jobUpdateCallbacks.delete(onUpdate);
    console.log(
      `[rpc] subscribeBrowserJobs unsubscribed - insertCbs: ${jobInsertCallbacks.size}, updateCbs: ${jobUpdateCallbacks.size}`,
    );
  };
}

export function watchAgentJob(
  agentJobId: string,
  onUpdate: (row: any) => void,
): () => void {
  let callbacks = agentJobCallbacks.get(agentJobId);
  if (!callbacks) {
    callbacks = new Set();
    agentJobCallbacks.set(agentJobId, callbacks);
  }
  callbacks.add(onUpdate);

  sendRequest<{ row: any }>({
    type: 'watch_agent_job',
    agent_job_id: agentJobId,
  })
    .then((response) => {
      if (response.row && callbacks!.has(onUpdate)) {
        onUpdate(response.row);
      }
    })
    .catch((err: Error) => {
      console.warn(`[rpc] watchAgentJob failed for ${agentJobId}: ${err.message}`);
      const set = agentJobCallbacks.get(agentJobId);
      set?.delete(onUpdate);
      if (set && set.size === 0) agentJobCallbacks.delete(agentJobId);
    });

  return () => {
    const set = agentJobCallbacks.get(agentJobId);
    if (set) {
      set.delete(onUpdate);
      if (set.size === 0) agentJobCallbacks.delete(agentJobId);
    }
    window.Finbro.rpc
      .request({ type: 'unwatch_agent_job', agent_job_id: agentJobId })
      .catch(() => {
        /* main process may be shutting down - ignore. */
      });
  };
}

// ── User inboxes (inbox-access, C12) ──────────────────────────────────

export async function listUserInboxes(): Promise<UserInbox[]> {
  try {
    const response = await sendRequest<{ rows: UserInbox[] }>({
      type: 'list_user_inboxes',
    });
    return response.rows || [];
  } catch (err) {
    console.error('[rpc] listUserInboxes failed:', err);
    return [];
  }
}

export async function addUserInbox(provider: 'gmail'): Promise<UserInbox> {
  const response = await sendRequest<{ inbox: UserInbox }>({
    type: 'add_user_inbox',
    provider,
  });
  if (!response.inbox) throw new Error('add_user_inbox returned no inbox');
  return response.inbox;
}

export async function removeUserInbox(inboxId: string): Promise<void> {
  await sendRequest({
    type: 'remove_user_inbox',
    inbox_id: inboxId,
  });
}

/** Subscribe to inbox_status_changed pushes (C14). The EmailAgent fires
 * `reading: true` immediately before `_run_inner_agent` and `reading:
 * false` in finally. Renderer-side `useInboxStatus` hook fans this into
 * a `Map<inbox_id, reading>`. */
export function subscribeInboxStatus(
  cb: (payload: { inbox_id: string; reading: boolean }) => void,
): () => void {
  inboxStatusCallbacks.add(cb);
  return () => {
    inboxStatusCallbacks.delete(cb);
  };
}
