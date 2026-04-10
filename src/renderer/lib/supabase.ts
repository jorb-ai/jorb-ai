import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

function tokenTag(t: string | null): string {
  if (!t) return 'NULL';
  if (t.length <= 16) return t;
  return `${t.slice(0, 8)}...${t.slice(-6)}`;
}

let supabase: SupabaseClient | null = null;
let currentToken: string | null = null;
let _url: string = '';
let _key: string = '';
let _initialized = false;

export function initSupabase(url: string, key: string): void {
  if (_initialized) return;
  _url = url;
  _key = key;
  _initialized = true;
  supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // If a token arrived before init, apply it now
  if (currentToken) {
    _applyToken(currentToken);
  }
}

function _applyToken(token: string): void {
  if (!_url || !_key) return;
  supabase = createClient(_url, _key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  supabase.realtime.setAuth(token);
}

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

export function setSupabaseToken(token: string | null): void {
  // Idempotency: same token means no state change needed. Prevents client
  // thrashing and the "Multiple GoTrueClient instances" warning when the
  // webapp re-pushes the same token on reloads.
  if (token === currentToken) {
    console.log(`[Supabase] setSupabaseToken — unchanged (${tokenTag(token)}), skipping`);
    return;
  }

  console.log(`[Supabase] setSupabaseToken — changed: ${tokenTag(currentToken)} -> ${tokenTag(token)}`);
  currentToken = token;

  if (supabase) {
    supabase.removeAllChannels();
  }

  if (token) {
    if (_initialized) {
      _applyToken(token);
    }
    // If not initialized yet, initSupabase will call _applyToken later
  } else {
    if (_initialized) {
      supabase = createClient(_url, _key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }
}

// Left panel: all browser_jobs for this user
export function subscribeUserJobs(
  userId: string,
  onInsert: (row: any) => void,
  onUpdate: (row: any) => void,
): RealtimeChannel | null {
  if (!supabase) {
    console.warn('[Supabase] subscribeUserJobs — no client');
    return null;
  }

  const userTag = userId.slice(0, 8);
  console.log(`[Supabase] subscribeUserJobs — user: ${userTag}, token: ${tokenTag(currentToken)}`);

  return supabase
    .channel('browser-jobs-user')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'browser_jobs', filter: `user_id=eq.${userId}` },
      (payload) => {
        console.log(`[Supabase] Realtime INSERT — browser_job ${payload.new?.id?.slice(0, 8) ?? '?'}`);
        onInsert(payload.new);
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'browser_jobs', filter: `user_id=eq.${userId}` },
      (payload) => {
        console.log(`[Supabase] Realtime UPDATE — browser_job ${payload.new?.id?.slice(0, 8) ?? '?'}, status: ${payload.new?.status}`);
        onUpdate(payload.new);
      },
    )
    .subscribe((status, err) => {
      const errMsg = err ? ` — error: ${err.message}` : '';
      if (status === 'SUBSCRIBED') {
        console.log(`[Supabase] browser-jobs-user channel: ${status}${errMsg}`);
      } else {
        console.warn(`[Supabase] browser-jobs-user channel: ${status}${errMsg}`);
      }
    });
}

// Right panel: events for a specific job
export function subscribeJobEvents(
  jobId: string,
  onUpdate: (row: any) => void,
): RealtimeChannel | null {
  if (!supabase) {
    console.warn('[Supabase] subscribeJobEvents — no client');
    return null;
  }

  const jobTag = jobId.slice(0, 8);
  console.log(`[Supabase] subscribeJobEvents — job: ${jobTag}`);

  return supabase
    .channel(`browser-job-${jobId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'browser_jobs', filter: `id=eq.${jobId}` },
      (payload) => onUpdate(payload.new),
    )
    .subscribe((status, err) => {
      const errMsg = err ? ` — error: ${err.message}` : '';
      if (status === 'SUBSCRIBED') {
        console.log(`[Supabase] browser-job-${jobTag} channel: ${status}${errMsg}`);
      } else {
        console.warn(`[Supabase] browser-job-${jobTag} channel: ${status}${errMsg}`);
      }
    });
}

// Initial fetch — enrich with job title/company from jobs table
export async function fetchUserJobs(userId: string): Promise<any[]> {
  if (!supabase || !currentToken) {
    console.warn(`[Supabase] fetchUserJobs — no client or token (supabase: ${!!supabase}, token: ${!!currentToken})`);
    return [];
  }

  console.log(`[Supabase] fetchUserJobs — user: ${userId.slice(0, 8)}, token: ${tokenTag(currentToken)}`);

  const { data, error } = await supabase
    .from('browser_jobs')
    .select('id, job_id, status, events, created_at, result_meta, error_message')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(`[Supabase] fetchUserJobs ERROR — ${error.message} (code: ${(error as any).code ?? '?'})`);
    return [];
  }

  console.log(`[Supabase] fetchUserJobs — returned ${data?.length ?? 0} rows`);

  if (!data || data.length === 0) return [];

  // Batch-enrich with job metadata
  const jobIds = [...new Set(data.map((j: any) => j.job_id))];
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, role, company')
    .in('id', jobIds);

  const jobMap = new Map((jobs || []).map((j: any) => [j.id, j]));

  return data.map((row: any) => {
    const job = jobMap.get(row.job_id);
    return { ...row, title: job?.role || null, company: job?.company || null };
  });
}

// Enrich a single browser_jobs row with job metadata
export async function enrichBrowserJob(row: any): Promise<any> {
  if (!supabase) return row;

  const { data, error } = await supabase
    .from('jobs')
    .select('role, company')
    .eq('id', row.job_id)
    .single();

  if (error) {
    console.error('[Supabase] enrichBrowserJob failed:', error.message);
    return { ...row, title: null, company: null };
  }

  return { ...row, title: data?.role || null, company: data?.company || null };
}

// Sub-agent job: Realtime subscription for tailoring progress (Phase 2)
export function subscribeAgentJob(
  agentJobId: string,
  onUpdate: (row: any) => void,
): RealtimeChannel | null {
  if (!supabase) return null;

  return supabase
    .channel(`agent-job-${agentJobId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'agent_jobs', filter: `id=eq.${agentJobId}` },
      (payload) => onUpdate(payload.new),
    )
    .subscribe();
}

// Look up a job's portal URL from the jobs table
export async function fetchJobLink(jobId: string): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('jobs')
    .select('link')
    .eq('id', jobId)
    .single();

  if (error || !data) return null;
  return data.link || null;
}
