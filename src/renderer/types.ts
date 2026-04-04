export interface BrowserJobRow {
  id: string;
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  events: BrowserEvent[];
  created_at: string;
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
        navigate: (url: string) => Promise<void>;
        resize: (width: number) => Promise<void>;
      };
    };
    finbro?: {
      sendAuthToken: (token: string | null) => void;
    };
    __FINBRO_ENV__?: { isElectron: boolean };
  }
}

export {};
