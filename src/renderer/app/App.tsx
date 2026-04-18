import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SessionList } from '../panels/session-list/SessionList';
import { ActionBar } from '../panels/action-bar/ActionBar';
import { ChatFeed } from '../panels/chat-feed/ChatFeed';
import { listBrowserJobs, subscribeBrowserJobs } from '../lib/rpc';
import type { BrowserJobRow } from '../types';
import { deriveDisplayStatus } from '../types';

const RIGHT_MIN = 200;
const RIGHT_MAX = 480;
const RIGHT_DEFAULT = 260;
const DESTROY_GRACE_MS = 30_000;

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);

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
  // We only need to know WHO is logged in (for the fetch effect guard) and
  // WHETHER they're logged in. The JWT itself lives in the main process and
  // drives WS registration there — the renderer never holds it directly
  // post-Phase-4.
  useEffect(() => {
    const cleanup = window.Finbro.auth.onTokenChanged((token) => {
      const prefix = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : 'NULL';
      console.log(`[App] onTokenChanged — token: ${prefix}`);
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
        console.warn('[App] LOGOUT — clearing sessions, activeJobId, grace timers');
        setUserId(null);
        setSessions([]);
        setActiveJobId(null);
        for (const timer of graceTimers.current.values()) clearTimeout(timer);
        graceTimers.current.clear();
      }
    });
    return cleanup;
  }, []);

  // ── Fetch + live updates via WS pubsub (Phase 4) ─────────────────
  // The server does the batch-enrichment (title/company from the jobs
  // table) and pushes full rows on INSERT/UPDATE. We dedupe on id and
  // merge on id — no need to preserve title/company across updates
  // because the server already includes them.
  //
  // The `unsubscribe` handle is hoisted OUT of the IIFE so the outer
  // cleanup can await it. A `return` from inside an async IIFE is
  // consumed by the IIFE caller, not the useEffect cleanup — the exact
  // class of leak that got us into Phase 4.
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    console.log(`[App] Fetch effect running — user: ${userId.slice(0, 8)}`);

    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const jobs = await listBrowserJobs();
      if (!mounted) return;
      console.log(`[App] Fetch effect — setSessions with ${jobs.length} rows`);
      setSessions(jobs);

      unsubscribe = subscribeBrowserJobs(
        (newRow) => {
          if (!mounted) return;
          setSessions((prev) => {
            if (prev.some((r) => r.id === newRow.id)) return prev;
            return [newRow, ...prev];
          });
        },
        (updatedRow) => {
          if (!mounted) return;
          setSessions((prev) =>
            prev.map((s) => (s.id === updatedRow.id ? { ...s, ...updatedRow } : s)),
          );
        },
      );

      // Race: the effect may have been torn down between the fetch and
      // the subscribe. If so, call unsubscribe immediately — the outer
      // cleanup already fired with unsubscribe === null.
      if (!mounted && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [isAuthenticated, userId]);

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

  const handleNavigate = useCallback((url: string, sessionId?: string) => {
    window.Finbro.panel.navigate(url, sessionId);
  }, []);

  const handleStop = useCallback((jobId: string) => {
    window.Finbro.browser.stop(jobId);
  }, []);

  const activeJob = sessions.find((s) => s.id === activeJobId) || null;
  // Events come directly off the active row — browser_job_updated broadcasts
  // include the full events array, so no separate subscription is needed.
  const events = activeJob?.events || [];

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
