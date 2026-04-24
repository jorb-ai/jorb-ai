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
  type: 'tool_call' | 'status' | 'error' | 'paused_for_tailor' | 'tailor_approved' | 'resumed';
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

/** Derive the display status from a browser job row. */
export function deriveDisplayStatus(job: BrowserJobRow): SessionDisplayStatus {
  if (job.status !== 'running') return job.status;
  const events = job.events || [];
  const pauseCount = events.filter((e) => e.type === 'paused_for_tailor').length;
  const approvedCount = events.filter((e) => e.type === 'tailor_approved').length;
  if (pauseCount > approvedCount) return 'needs_attention';
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
      };
      panel: {
        navigate: (url: string, sessionId?: string) => Promise<void>;
        setBarHeight: (height: number) => Promise<void>;
      };
      session: {
        show: (sessionId: string) => Promise<boolean>;
        showTailor: (sessionId: string) => Promise<boolean>;
        showPlaceholder: () => Promise<void>;
        destroy: (sessionId: string) => Promise<void>;
        status: () => Promise<{ count: number; atCapacity: boolean }>;
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
