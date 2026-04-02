import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

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
  if (!supabase) return null;

  return supabase
    .channel('browser-jobs-user')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'browser_jobs', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'browser_jobs', filter: `user_id=eq.${userId}` },
      (payload) => onUpdate(payload.new),
    )
    .subscribe();
}

// Right panel: events for a specific job
export function subscribeJobEvents(
  jobId: string,
  onUpdate: (row: any) => void,
): RealtimeChannel | null {
  if (!supabase) return null;

  return supabase
    .channel(`browser-job-${jobId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'browser_jobs', filter: `id=eq.${jobId}` },
      (payload) => onUpdate(payload.new),
    )
    .subscribe();
}

// Initial fetch
export async function fetchUserJobs(userId: string): Promise<any[]> {
  if (!supabase || !currentToken) return [];

  const { data, error } = await supabase
    .from('browser_jobs')
    .select('id, job_id, status, events, created_at, result_meta, error_message')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[Supabase] fetchUserJobs error:', error.message);
    return [];
  }
  return data || [];
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
