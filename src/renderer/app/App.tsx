import React, { useState, useEffect, useCallback } from 'react';
import { SessionList } from '../panels/session-list/SessionList';
import { ActionBar } from '../panels/action-bar/ActionBar';
import { SessionPlaceholder } from '../components/SessionPlaceholder';
import { listBrowserJobs, subscribeBrowserJobs } from '../lib/rpc';
import type { BrowserJobRow } from '../types';

const INBOX_TAB_PREFIX = '__inbox_';

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | null>('__webapp__');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [seenCompletedJobIds, setSeenCompletedJobIds] = useState<Set<string>>(new Set());

  // ── Worker-driven active-session sync ───────────────────────────
  useEffect(() => {
    const cleanup = window.Finbro.session.onActiveChanged((sessionId) => {
      if (!sessionId) return;
      setShowPlaceholder(false);
      if (sessionId.startsWith('__')) {
        setActiveNavId((prev) => (prev === sessionId ? prev : sessionId));
        setActiveJobId((prev) => (prev === null ? prev : null));
      } else {
        setActiveJobId((prev) => (prev === sessionId ? prev : sessionId));
        setActiveNavId((prev) => (prev === null ? prev : null));
      }
    });
    return cleanup;
  }, []);

  // ── Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = window.Finbro.auth.onTokenChanged((token) => {
      const tokenPrefix = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : 'NULL';
      setIsAuthenticated(!!token);
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const newUserId = payload.sub || null;
          console.log(`[App] auth token changed — token: ${tokenPrefix}, userId: ${newUserId?.slice(0, 8) ?? 'null'}`);
          setUserId(newUserId);
        } catch {
          console.warn('[App] auth token changed — failed to parse JWT');
          setUserId(null);
        }
      } else {
        console.log('[App] auth cleared — user logged out');
        setUserId(null);
        setSessions([]);
        setActiveJobId(null);
        setActiveNavId('__webapp__');
        setShowPlaceholder(false);
        setSeenCompletedJobIds(new Set());
      }
    });
    return cleanup;
  }, []);

  // ── Fetch + live updates via WS pubsub ──────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    console.log(`[App] data effect mounting — userId: ${userId.slice(0, 8)}`);
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const t0 = performance.now();
      const jobs = await listBrowserJobs();
      const dt = Math.round(performance.now() - t0);
      console.log(`[App] listBrowserJobs returned ${jobs.length} rows in ${dt}ms (mounted: ${mounted})`);
      if (!mounted) return;
      setSessions(jobs);

      unsubscribe = subscribeBrowserJobs(
        (newRow) => {
          if (!mounted) {
            console.warn(`[App] insert callback fired AFTER unmount — id: ${newRow.id?.slice(0, 8)}, dropped`);
            return;
          }
          setSessions((prev) => {
            if (prev.some((r) => r.id === newRow.id)) return prev;
            console.log(`[App] sessions+= ${newRow.id?.slice(0, 8)} (was ${prev.length})`);
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
      console.log(`[App] data effect unmounting — userId: ${userId.slice(0, 8)}`);
      mounted = false;
      unsubscribe?.();
    };
  }, [isAuthenticated, userId]);

  // ── Green-tint acknowledgement ───────────────────────────────────
  useEffect(() => {
    if (!activeJobId) return;
    const job = sessions.find((s) => s.id === activeJobId);
    if (job?.status !== 'completed') return;
    setSeenCompletedJobIds((prev) => {
      if (prev.has(activeJobId)) return prev;
      const next = new Set(prev);
      next.add(activeJobId);
      return next;
    });
  }, [activeJobId, sessions]);

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSelectSession = useCallback(async (jobId: string) => {
    setActiveJobId(jobId);
    setActiveNavId(null);
    const shown = await window.Finbro.session.show(jobId);
    setShowPlaceholder(!shown);
  }, []);

  const handleNavigate = useCallback((url: string, sessionId?: string) => {
    const sid = sessionId ?? '__webapp__';
    setActiveJobId(null);
    setActiveNavId(sid);
    setShowPlaceholder(false);
    // Inbox tabs are managed by `session.showOrNavigateInbox` (called
    // by EmailsSection directly, plus the JorbHeader pre-search
    // affordance). Generic panel.navigate would route through
    // showOrNavigateSession's origin-match short-circuit, which would
    // swallow Gmail-search URL fragment changes. So we DON'T fire
    // panel.navigate for inbox tabs - we just sync activeNavId.
    if (sid.startsWith(INBOX_TAB_PREFIX)) return;
    window.Finbro.panel.navigate(url, sid);
  }, []);

  const handleStop = useCallback((jobId: string) => {
    window.Finbro.browser.stop(jobId);
  }, []);

  const handleContinue = useCallback((jobId: string) => {
    window.Finbro.browser.continueJob(jobId);
  }, []);

  const handleCloseSession = useCallback(async (jobId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== jobId));
    if (activeJobId === jobId) {
      setActiveJobId(null);
      setActiveNavId('__webapp__');
      setShowPlaceholder(false);
      window.Finbro.panel.navigate('http://localhost:3000', '__webapp__');
    }
    await window.Finbro.session.destroy(jobId);
    await window.Finbro.browser.close(jobId);
  }, [activeJobId]);

  const activeJob = sessions.find((s) => s.id === activeJobId) || null;

  return (
    <div className="app-shell">
      <div className="panel-left">
        <SessionList
          sessions={sessions}
          activeJobId={activeJobId}
          activeNavId={activeNavId}
          seenCompletedJobIds={seenCompletedJobIds}
          onSelect={handleSelectSession}
          onNavigate={handleNavigate}
          onClose={handleCloseSession}
          emailsEnabled={isAuthenticated && !!userId}
        />
      </div>
      <div className="panel-middle">
        <ActionBar
          activeJob={activeJob}
          activeNavId={activeNavId}
          sessions={sessions}
          onStop={handleStop}
          onContinue={handleContinue}
        />
        <div className="panel-browser">
          {showPlaceholder && activeJob && <SessionPlaceholder job={activeJob} />}
        </div>
      </div>
    </div>
  );
};
