import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SessionList } from '../panels/session-list/SessionList';
import { ActionBar } from '../panels/action-bar/ActionBar';
import { SessionPlaceholder } from '../components/SessionPlaceholder';
import { listBrowserJobs, subscribeBrowserJobs } from '../lib/rpc';
import type { BrowserJobRow } from '../types';

const DESTROY_GRACE_MS = 30_000;

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | null>('__webapp__');
  const [placeholderActive, setPlaceholderActive] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const graceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const activeJobIdRef = useRef<string | null>(null);
  useEffect(() => { activeJobIdRef.current = activeJobId; }, [activeJobId]);

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
        const timer = setTimeout(async () => {
          const wasActive = activeJobIdRef.current === jobId;
          if (wasActive) {
            // Detach all views before destroy so the placeholder card can
            // render — otherwise removing viewA would reveal whichever
            // other session was most-recently-added behind it.
            setPlaceholderActive(true);
            try { await window.Finbro.session.showPlaceholder(); } catch {}
          }
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

  // ── Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = window.Finbro.auth.onTokenChanged((token) => {
      setIsAuthenticated(!!token);
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUserId(payload.sub || null);
        } catch {
          setUserId(null);
        }
      } else {
        setUserId(null);
        setSessions([]);
        setActiveJobId(null);
        setActiveNavId('__webapp__');
        setPlaceholderActive(false);
        for (const timer of graceTimers.current.values()) clearTimeout(timer);
        graceTimers.current.clear();
      }
    });
    return cleanup;
  }, []);

  // ── Fetch + live updates via WS pubsub ──────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const jobs = await listBrowserJobs();
      if (!mounted) return;
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
    setActiveNavId(null);

    const shown = await window.Finbro.session.show(jobId);
    if (shown) {
      setPlaceholderActive(false);
    } else {
      setPlaceholderActive(true);
      try { await window.Finbro.session.showPlaceholder(); } catch {}
    }
  }, []);

  const handleNavigate = useCallback((url: string, sessionId?: string) => {
    const sid = sessionId ?? '__webapp__';
    setActiveJobId(null);
    setActiveNavId(sid);
    setPlaceholderActive(false);
    window.Finbro.panel.navigate(url, sid);
  }, []);

  const handleStop = useCallback((jobId: string) => {
    window.Finbro.browser.stop(jobId);
  }, []);

  const activeJob = sessions.find((s) => s.id === activeJobId) || null;

  return (
    <div className="app-shell">
      <div className="panel-left">
        <SessionList
          sessions={sessions}
          activeJobId={activeJobId}
          activeNavId={activeNavId}
          onSelect={handleSelectSession}
          onNavigate={handleNavigate}
        />
      </div>
      <div className="panel-middle">
        <ActionBar
          activeJob={activeJob}
          activeNavId={activeNavId}
          onStop={handleStop}
        />
        <div className="panel-browser">
          {placeholderActive && activeJob && (
            <SessionPlaceholder job={activeJob} />
          )}
        </div>
      </div>
    </div>
  );
};
