import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SessionList } from '../panels/session-list/SessionList';
import { ActionBar } from '../panels/action-bar/ActionBar';
import { ChatFeed } from '../panels/chat-feed/ChatFeed';
import {
  initSupabase,
  setSupabaseToken,
  subscribeUserJobs,
  subscribeJobEvents,
  fetchUserJobs,
  enrichBrowserJob,
  getSupabase,
} from '../lib/supabase';
import type { BrowserJobRow, BrowserEvent } from '../types';
import { deriveDisplayStatus } from '../types';

initSupabase(
  'https://optsvxrgzocfuyyrbkqd.supabase.co',
  'sb_publishable_bJw9zTxyqsiE83gw8kV6Cw_tXyCXGLc',
);

const RIGHT_MIN = 200;
const RIGHT_MAX = 480;
const RIGHT_DEFAULT = 260;
const DESTROY_GRACE_MS = 30_000;

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // authToken is tracked as state purely to drive the fetch useEffect to re-run
  // when the webapp pushes a refreshed token after the initial stale read.
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const graceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // ── Grace timer: destroy BrowserView 30s after terminal status ──────
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    // Cancel timers for sessions that disappeared from state
    for (const [id, timer] of graceTimers.current) {
      if (!currentIds.has(id)) {
        clearTimeout(timer);
        graceTimers.current.delete(id);
      }
    }

    for (const job of sessions) {
      const isTerminal = job.status === 'completed' || job.status === 'failed' || job.status === 'stopped';
      if (isTerminal && !graceTimers.current.has(job.id)) {
        const jobId = job.id;
        const timer = setTimeout(() => {
          window.Finbro.session.destroy(jobId);
          graceTimers.current.delete(jobId);
        }, DESTROY_GRACE_MS);
        graceTimers.current.set(job.id, timer);
      }
      if (!isTerminal && graceTimers.current.has(job.id)) {
        clearTimeout(graceTimers.current.get(job.id)!);
        graceTimers.current.delete(job.id);
      }
    }
  }, [sessions]);

  // Clean up grace timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of graceTimers.current.values()) clearTimeout(timer);
    };
  }, []);

  // ── Right panel resize ──────────────────────────────────────────
  const isDragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const fromRight = window.innerWidth - ev.clientX;
      const clamped = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, fromRight));
      setRightWidth(clamped);
      window.Finbro.panel.resize(clamped);
    };

    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ── Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = window.Finbro.auth.onTokenChanged((token) => {
      const prefix = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : 'NULL';
      console.log(`[App] onTokenChanged — token: ${prefix}`);
      setSupabaseToken(token);
      setAuthToken(token);
      setIsAuthenticated(!!token);

      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const sub = payload.sub || null;
          const exp = payload.exp;
          const now = Math.floor(Date.now() / 1000);
          const ttl = exp ? exp - now : null;
          console.log(`[App] Decoded JWT — sub: ${sub?.slice(0, 8) ?? 'none'}, ttl: ${ttl ?? '?'}s`);
          if (ttl !== null && ttl <= 0) {
            console.warn(`[App] WARNING: received EXPIRED token (ttl: ${ttl}s)`);
          }
          setUserId(sub);
        } catch (err) {
          console.error('[App] Failed to decode JWT:', err);
          setUserId(null);
        }
      } else {
        console.warn('[App] LOGOUT — clearing sessions, activeJobId, events, grace timers');
        setUserId(null);
        setSessions([]);
        setActiveJobId(null);
        setEvents([]);
        // C5 fix: clear all grace timers on logout
        for (const timer of graceTimers.current.values()) clearTimeout(timer);
        graceTimers.current.clear();
      }
    });
    return cleanup;
  }, []);

  // ── Fetch + Realtime subscription for sessions ───────────────────
  // authToken is included in the dep array so that if the webapp pushes a
  // refreshed token after the initial (possibly stale) token, we re-fetch
  // against the fresh client instead of leaving the sidebar frozen on the
  // empty result from the stale-token fetch.
  useEffect(() => {
    if (!isAuthenticated || !userId || !authToken) return;

    console.log(`[App] Fetch effect running — user: ${userId.slice(0, 8)}, token: ${authToken.slice(0, 8)}...${authToken.slice(-6)}`);

    let userChannel: any = null;
    let mounted = true;

    (async () => {
      const jobs = await fetchUserJobs(userId);
      if (!mounted) return;
      console.log(`[App] Fetch effect — setSessions with ${jobs.length} rows`);
      setSessions(jobs as BrowserJobRow[]);

      userChannel = subscribeUserJobs(
        userId,
        async (newRow: any) => {
          if (!mounted) return;
          console.log(`[App] Realtime INSERT — browser_job ${newRow.id?.slice(0, 8)}`);
          try {
            const enriched = await enrichBrowserJob(newRow);
            if (!mounted) return;
            setSessions((prev) => [enriched as BrowserJobRow, ...prev]);
          } catch {
            setSessions((prev) => [newRow as BrowserJobRow, ...prev]);
          }
          // Phase 3: do NOT auto-focus new jobs — user stays on current session
        },
        (updatedRow: any) => {
          if (!mounted) return;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === updatedRow.id ? { ...s, ...updatedRow, title: s.title, company: s.company } : s,
            ),
          );
        },
      );
      console.log(`[App] Subscribed to browser_jobs channel for user ${userId.slice(0, 8)}`);
    })();

    return () => {
      mounted = false;
      if (userChannel) {
        getSupabase()?.removeChannel(userChannel);
      }
    };
  }, [isAuthenticated, userId, authToken]);

  // ── Job events subscription ──────────────────────────────────────
  useEffect(() => {
    if (!activeJobId) {
      setEvents([]);
      return;
    }

    const job = sessionsRef.current.find((s) => s.id === activeJobId);
    setEvents(job?.events || []);

    const channel = subscribeJobEvents(activeJobId, (updatedRow: any) => {
      setEvents(updatedRow.events || []);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === updatedRow.id ? { ...s, ...updatedRow, title: s.title, company: s.company } : s,
        ),
      );
    });

    return () => {
      if (channel) {
        getSupabase()?.removeChannel(channel);
      }
    };
  }, [activeJobId]);

  // ── Handlers ─────────────────────────────────────────────────────
  const handleSelectSession = useCallback(async (jobId: string) => {
    setActiveJobId(jobId);
    // Show the session's BrowserView pair. If the session doesn't exist
    // (e.g. queued job, or destroyed after completion), show falls through
    // gracefully — the middle panel stays on whatever was previously visible.
    // The web app (__webapp__) session is shown as a fallback for non-running jobs.
    const shown = await window.Finbro.session.show(jobId);
    if (!shown) {
      window.Finbro.session.show('__webapp__');
    }
  }, []);

  const handleNavigate = useCallback((url: string) => {
    window.Finbro.panel.navigate(url);
  }, []);

  const handleStop = useCallback((jobId: string) => {
    window.Finbro.browser.stop(jobId);
  }, []);

  const activeJob = sessions.find((s) => s.id === activeJobId) || null;

  // Compute needs_attention count for badge
  const needsAttentionCount = sessions.filter(
    (s) => deriveDisplayStatus(s) === 'needs_attention',
  ).length;

  return (
    <div className="app-shell">
      <div className="panel-left">
        <SessionList
          sessions={sessions}
          activeJobId={activeJobId}
          onSelect={handleSelectSession}
          onNavigate={handleNavigate}
          needsAttentionCount={needsAttentionCount}
        />
      </div>
      <div className="panel-middle">
        <ActionBar activeJob={activeJob} onStop={handleStop} />
      </div>
      <div className="panel-resize-handle" onMouseDown={onResizeStart} />
      <div className="panel-right" style={{ width: rightWidth, minWidth: rightWidth }}>
        <ChatFeed events={events} isRunning={activeJob?.status === 'running'} activeJobId={activeJobId} />
      </div>
    </div>
  );
};
