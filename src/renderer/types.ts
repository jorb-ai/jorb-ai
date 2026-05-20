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
  type: 'tool_call' | 'status' | 'error' | 'paused_for_tailor' | 'tailor_ready' | 'tailor_approved' | 'resumed';
  tool?: string;
  message: string;
  ts: string;
  doc_type?: 'resume' | 'cover_letter';
  agent_job_id?: string;
  file_path?: string;
}

export interface AgentJobEvent {
  type: 'base_selected' | 'edit' | 'reasoning' | 'memory';
  base_name?: string;
  reasoning?: string;
  text?: string;
  [key: string]: any;
}

/** Derived display status for session rows. */
export type SessionDisplayStatus = BrowserJobRow['status'] | 'needs_attention';

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
 */
export function deriveDisplayStatus(job: BrowserJobRow): SessionDisplayStatus {
  if (job.status !== 'running') return job.status;
  const events = job.events || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === 'tailor_ready') return 'needs_attention';
    if (t === 'paused_for_tailor' || t === 'tailor_approved' || t === 'resumed') return 'running';
  }
  return 'running';
}

declare global {
  interface Window {
    Finbro: {
      config: {
        get: () => Promise<{ config: any }>;
        set: (config: any) => Promise<void>;
      };
      auth: {
        sendAuthToken: (token: string | null) => Promise<void>;
        onTokenChanged: (callback: (token: string | null) => void) => () => void;
      };
      browser: {
        stop: (jobId: string) => Promise<void>;
        close: (jobId: string) => Promise<void>;
      };
      panel: {
        navigate: (url: string, sessionId?: string) => Promise<void>;
        setBarHeight: (height: number) => Promise<void>;
      };
      session: {
        show: (sessionId: string) => Promise<boolean>;
        showTailor: (sessionId: string) => Promise<boolean>;
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
    };
    finbro?: {
      sendAuthToken: (token: string | null) => void;
    };
    __FINBRO_ENV__?: { isElectron: boolean };
  }
}

export {};
