export interface BrowserJobRow {
  id: string;
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  events: BrowserEvent[];
  created_at: string;
  completed_at?: string | null;
  result_meta?: any;
  error_message?: string;
  // Enriched from jobs table (may be null for old rows)
  title?: string;
  company?: string;
}

export interface BrowserEvent {
  type:
    | 'tool_call'
    | 'status'
    | 'error'
    | 'paused_for_tailor'
    | 'tailor_ready'
    | 'tailor_approved'
    | 'resumed'
    | 'paused_for_user';
  tool?: string;
  message?: string;
  ts?: string;
  doc_type?: 'resume' | 'cover_letter';
  agent_job_id?: string;
  file_path?: string;
  // Inbox-access (C13): `paused_for_user` carries a give_up reason from
  // the EmailAgent's taxonomy + an optional inbox_id, powering the
  // action-bar Continue speech variant.
  reason?: PausedForUserReason;
  inbox_id?: string;
}

/** Inbox-access give_up taxonomy (C13). Tab-agnostic, six values. Renderer
 * holds the matching speech strings; server emits only the reason code. */
export type PausedForUserReason =
  | 'no_inbox_connected'
  | 'user_not_logged_in'
  | 'no_matching_email'
  | 'multiple_candidates_ambiguous'
  | 'email_unreadable'
  | 'session_expired_mid_read';

export interface AgentJobEvent {
  type: 'base_selected' | 'edit' | 'reasoning' | 'memory';
  base_name?: string;
  reasoning?: string;
  text?: string;
  [key: string]: any;
}

/** One row in `user_inboxes`. Fetched via `list_user_inboxes` WS request
 * and maintained locally via `user_inbox_added` / `user_inbox_removed`
 * correlated responses. See contracts.md C12. */
export interface UserInbox {
  id: string;
  provider: 'gmail';
  label: string | null;
  created_at: string;
}

/** Derived display status for session rows. */
export type SessionDisplayStatus =
  | BrowserJobRow['status']
  | 'needs_attention'
  | 'paused_for_user';

/**
 * Derive the display status from a browser job row.
 *
 * Within a running job the tailoring sub-flow has three sub-states, told
 * apart by the latest tailor-cycle event:
 *   paused_for_tailor          -> sub-agent working      -> running
 *   tailor_ready               -> awaiting user approval -> needs_attention
 *   tailor_approved / resumed  -> approved, agent resumed -> running
 * `tailor_ready` is the only event that means "your turn"; keying off it
 * (not the paused_for_tailor count) is what lets the shell time the signal.
 *
 * Inbox-access adds `paused_for_user`: the EmailAgent gave up on autopilot
 * and the apply tool is awaiting a Continue click. Treated as a distinct
 * state so the action bar can render the Continue button + reason variant.
 * `resumed` (emitted when Continue resolves) flips back to running.
 */
export function deriveDisplayStatus(job: BrowserJobRow): SessionDisplayStatus {
  if (job.status !== 'running') return job.status;
  const events = job.events || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === 'paused_for_user') return 'paused_for_user';
    if (t === 'tailor_ready') return 'needs_attention';
    if (
      t === 'paused_for_tailor' ||
      t === 'tailor_approved' ||
      t === 'resumed'
    ) {
      return 'running';
    }
  }
  return 'running';
}

/** The most recent `paused_for_user` event payload on a job, or null
 * if the job is not currently paused_for_user. Walks newest-first and
 * bails on any later-than-paused tailor / resumed event (which would
 * indicate the pause was resolved already). */
export function latestPausedForUser(job: BrowserJobRow): BrowserEvent | null {
  const events = job.events || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'resumed' || e.type === 'tailor_approved') return null;
    if (e.type === 'paused_for_user') return e;
  }
  return null;
}

declare global {
  interface AuthState {
    isAuthenticated: boolean;
    userId: string | null;
  }

  interface Window {
    Finbro: {
      config: {
        get: () => Promise<{ config: { debugMode: boolean; automationServerUrl: string; webAppUrl: string } }>;
        set: (config: Partial<{ debugMode: boolean; automationServerUrl: string; webAppUrl: string }>) => Promise<void>;
      };
      auth: {
        onTokenChanged: (callback: (state: AuthState) => void) => () => void;
      };
      browser: {
        stop: (jobId: string) => Promise<void>;
        continueJob: (jobId: string) => Promise<void>;
        close: (jobId: string) => Promise<void>;
      };
      panel: {
        navigate: (url: string, sessionId?: string) => Promise<void>;
        setBarHeight: (height: number) => Promise<void>;
      };
      session: {
        show: (sessionId: string) => Promise<boolean>;
        showTailor: (sessionId: string) => Promise<boolean>;
        showOrNavigateInbox: (sessionId: string, url?: string) => Promise<void>;
        destroy: (sessionId: string) => Promise<void>;
        status: () => Promise<{ count: number; atCapacity: boolean }>;
        onActiveChanged: (callback: (sessionId: string) => void) => () => void;
      };
      rpc: {
        request: (msg: unknown) => Promise<void>;
        subscribe: () => Promise<void>;
        unsubscribe: () => Promise<void>;
        onEvent: (callback: (event: unknown) => void) => () => void;
      };
      // Dev observability: forward a renderer state transition to the main log.
      debug: (scope: string, msg: string) => void;
      // Dev-only: graft real Chrome cookies into persist:portal (makeshift).
      dev: {
        importCookies: () => Promise<{ ok: boolean; error?: string; browserName?: string; profile?: string; imported?: number; total?: number; domains?: number }>;
      };
    };
    __FINBRO_ENV__?: { isElectron: boolean };
  }
}

export {};
