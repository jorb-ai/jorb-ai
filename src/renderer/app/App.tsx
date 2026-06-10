import React, { useState, useEffect, useCallback } from 'react';
import { SessionList } from '../panels/session-list/SessionList';
import { ActionBar } from '../panels/action-bar/ActionBar';
import { TabLoadingSkeleton } from '../components/TabLoadingSkeleton';
import { listBrowserJobs, subscribeBrowserJobs } from '../lib/rpc';
import type { BrowserJobRow } from '../types';

const INBOX_TAB_PREFIX = '__inbox_';
const DEFAULT_WEBAPP_URL = import.meta.env.DEV ? 'http://localhost:3000' : 'https://jorb.ai';

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | null>('__webapp__');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // The active tab hasn't painted yet (main keeps every view detached) —
  // the middle panel shows the loading skeleton until main's
  // active-changed push flips loading off. Main's truth, mirrored here.
  const [tabLoading, setTabLoading] = useState(false);
  const [seenCompletedJobIds, setSeenCompletedJobIds] = useState<Set<string>>(new Set());
  const [webAppUrl, setWebAppUrl] = useState(DEFAULT_WEBAPP_URL);

  useEffect(() => {
    let mounted = true;
    window.Finbro.config.get()
      .then(({ config }) => {
        if (mounted && typeof config?.webAppUrl === 'string' && config.webAppUrl) {
          setWebAppUrl(config.webAppUrl);
        }
      })
      .catch((err: Error) => {
        console.warn(`[App] config load failed: ${err.message}`);
      });
    return () => { mounted = false; };
  }, []);

  // ── Active-session sync (user click, worker auto-jump, load-complete) ──
  useEffect(() => {
    const cleanup = window.Finbro.session.onActiveChanged((sessionId, loading) => {
      if (!sessionId) return;
      window.Finbro.debug('app', `active-changed -> ${sessionId}${loading ? ' (loading)' : ''}`);
      setTabLoading(loading);
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
    const cleanup = window.Finbro.auth.onTokenChanged((state) => {
      setIsAuthenticated(state.isAuthenticated);
      if (state.isAuthenticated) {
        console.log(`[App] auth state changed: userId=${state.userId?.slice(0, 8) ?? 'null'}`);
        setUserId(state.userId);
      } else {
        console.log('[App] auth cleared: user logged out');
        setUserId(null);
        setSessions([]);
        setActiveJobId(null);
        setActiveNavId('__webapp__');
        setTabLoading(false);
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
    const state = await window.Finbro.session.show(jobId);
    window.Finbro.debug('app', `select ${jobId.slice(0, 8)} -> ${state}`);
    if (state !== 'shown') setTabLoading(true);
    if (state === 'none') {
      // No live view (a job from an earlier app run, or queued pre-navigate):
      // open the session straight onto the posting page. The skeleton is
      // already up; main attaches the view on first-load completion.
      const job = sessions.find((s) => s.id === jobId);
      if (job?.url) {
        try {
          await window.Finbro.panel.navigate(job.url, jobId);
        } catch (e) {
          window.Finbro.debug('app', `navigate ${jobId.slice(0, 8)} failed: ${(e as Error).message}`);
          setTabLoading(false);
        }
      } else {
        // No posting URL on the row (old/custom rows) — nothing to open.
        window.Finbro.debug('app', `select ${jobId.slice(0, 8)} -> no url, falling back to webapp`);
        setTabLoading(false);
        setActiveJobId(null);
        setActiveNavId('__webapp__');
        window.Finbro.panel.navigate(webAppUrl, '__webapp__');
      }
    }
  }, [sessions, webAppUrl]);

  const handleNavigate = useCallback((url: string, sessionId?: string) => {
    const sid = sessionId ?? '__webapp__';
    setActiveJobId(null);
    setActiveNavId(sid);
    // Inbox tabs are managed by `session.showOrNavigateInbox` (called by
    // EmailsSection directly), which owns the inbox view's lifecycle. So
    // we DON'T fire panel.navigate for inbox tabs - we just sync
    // activeNavId.
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
      window.Finbro.panel.navigate(webAppUrl, '__webapp__');
    }
    await window.Finbro.session.destroy(jobId);
    await window.Finbro.browser.close(jobId);
  }, [activeJobId, webAppUrl]);

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
          webAppUrl={webAppUrl}
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
          {tabLoading && <TabLoadingSkeleton />}
        </div>
      </div>
    </div>
  );
};
