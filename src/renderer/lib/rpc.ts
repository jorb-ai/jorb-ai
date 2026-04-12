/**
 * Renderer-side data layer (Phase 4). Talks to the main process over IPC,
 * which forwards over the WebSocket. Does NOT open its own WS — the main
 * process owns the connection.
 *
 * Replaces renderer/lib/supabase.ts. The renderer never imports
 * @supabase/supabase-js; all queries and live updates flow through this
 * module. See workstreams/browser/PHASE4.md Spec 4.3 for the design doc.
 */

import type { BrowserJobRow } from '../types';

// Correlation id → entry used to resolve/reject the caller's Promise and
// cancel the timeout timer. Every request is bounded so a dropped server
// response cannot hang a React effect forever — the exact failure class
// we are exiting Phase 3 to escape, one layer removed.
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

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ── Event router ─────────────────────────────────────────────────────

// Register the IPC event listener once at module load. The preload bridge
// always exists by the time renderer code runs (contextBridge is sync).
window.Finbro.rpc?.onEvent((event: any) => {
  // Correlated response — route to the pending entry by id.
  if (event?.id && pending.has(event.id)) {
    const entry = pending.get(event.id)!;
    pending.delete(event.id);
    clearTimeout(entry.timer);
    // Server-side error responses (e.g. watch_agent_job ownership
    // rejection) come back as {id, type: "error", error: "..."}. Reject
    // so consumers see a thrown error instead of silently resolving with
    // an error-shaped object.
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
      jobInsertCallbacks.forEach((cb) => cb(event.row));
      break;
    case 'browser_job_updated':
      jobUpdateCallbacks.forEach((cb) => cb(event.row));
      break;
    case 'agent_job_updated': {
      const rowId = event.row?.id;
      if (rowId) {
        agentJobCallbacks.get(rowId)?.forEach((cb) => cb(event.row));
      }
      break;
    }
    default:
      // Ignore CDP/navigate/file-sync/panel-switch and anything else
      // the main-process dispatcher owns.
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
    // Fire and forget — the response comes back via the onEvent listener.
    // If the IPC invoke itself rejects (preload gone, main process dead),
    // surface that via the pending entry so the caller's await reports it.
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

// ── Public surface ───────────────────────────────────────────────────

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
  // One-way idempotent command — no correlation needed.
  window.Finbro.rpc.subscribe();
  return () => {
    jobInsertCallbacks.delete(onInsert);
    jobUpdateCallbacks.delete(onUpdate);
  };
}

export function watchAgentJob(
  agentJobId: string,
  onUpdate: (row: any) => void,
): () => void {
  // Register the push callback BEFORE sending the watch request so no
  // agent_job_updated message can slip past between the initial snapshot
  // and the callback registration.
  let callbacks = agentJobCallbacks.get(agentJobId);
  if (!callbacks) {
    callbacks = new Set();
    agentJobCallbacks.set(agentJobId, callbacks);
  }
  callbacks.add(onUpdate);

  // Fire the watch request. If it rejects (timeout, ownership denied),
  // clean up the callback so we don't leak a dead entry.
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
    // Fire-and-forget unwatch — no correlation, no response expected.
    window.Finbro.rpc
      .request({ type: 'unwatch_agent_job', agent_job_id: agentJobId })
      .catch(() => {
        // Main process may be shutting down — ignore.
      });
  };
}
