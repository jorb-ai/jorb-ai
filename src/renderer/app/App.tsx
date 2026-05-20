import React, { useState, useEffect, useCallback } from 'react';
import { SessionList } from '../panels/session-list/SessionList';
import { ActionBar } from '../panels/action-bar/ActionBar';
import { SessionPlaceholder } from '../components/SessionPlaceholder';
import { listBrowserJobs, subscribeBrowserJobs } from '../lib/rpc';
import type { BrowserJobRow } from '../types';

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | null>('__webapp__');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // True when the selected job has no live tab — the middle panel shows a
  // SessionPlaceholder card instead of a BrowserView. Driven by the
  // `session.show` return value (false = no view) and cleared whenever a
  // real view comes to the front.
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  // Completed jobs the user has viewed while completed. A finished job
  // greets the user with a green tint; once they open it (see the result)
  // the green drops. Keyed off "viewed while completed", not "ever
  // opened", so opening a job to watch it run does not pre-clear the
  // green it should show the moment it finishes.
  const [seenCompletedJobIds, setSeenCompletedJobIds] = useState<Set<string>>(new Set());

  // ── Worker-driven active-session sync (Phase 5.2) ───────────────
  // When the worker sends `navigate` for a job, main calls showSession
  // which now pushes session:active-changed. Mirror it into activeJobId
  // so the sidebar row picks up the active pill without the user
  // having to click.
  //
  // Functional setters guard against same-state pushes — if the incoming
  // sessionId already matches what's mounted, both setters bail without
  // re-rendering. Defensive against future call sites in main that might
  // emit redundant pushes (e.g. a re-show of the already-active session).
  useEffect(() => {
    const cleanup = window.Finbro.session.onActiveChanged((sessionId) => {
      if (!sessionId) return;
      // onActiveChanged only fires from showSession's success path — a
      // session with a live BrowserView is now on top, so we're no
      // longer showing a placeholder.
      setShowPlaceholder(false);
      if (sessionId.startsWith('__')) {
        // System session (webapp / gmail / outlook).
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

  // ── Green-tint acknowledgement (F2) ──────────────────────────────
  // A job enters `seenCompletedJobIds` once the user has it active while
  // it is completed. After that its sidebar green tint drops: the user
  // has reviewed the finished application. Watching a job *run* does not
  // count; that was the bug where the green never got a chance to show.
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
    // `session.show` returns false when the job has no live BrowserView —
    // a queued job the worker hasn't navigated, or a job from an earlier
    // run. On false, main has detached all views; render the
    // SessionPlaceholder card so the middle panel matches the selection.
    const shown = await window.Finbro.session.show(jobId);
    setShowPlaceholder(!shown);
  }, []);

  const handleNavigate = useCallback((url: string, sessionId?: string) => {
    const sid = sessionId ?? '__webapp__';
    setActiveJobId(null);
    setActiveNavId(sid);
    setShowPlaceholder(false);
    window.Finbro.panel.navigate(url, sid);
  }, []);

  const handleStop = useCallback((jobId: string) => {
    window.Finbro.browser.stop(jobId);
  }, []);

  const handleCloseSession = useCallback(async (jobId: string) => {
    // Optimistic remove from local state. The server endpoint stops the
    // worker (if running) and DELETEs the row in one shot; the next
    // pubsub poll will see the row gone and the diff naturally drops it.
    // If the close call fails the row stays gone locally until the next
    // app start — preferable to a stuck-hidden ghost row.
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
        />
      </div>
      <div className="panel-middle">
        <ActionBar
          activeJob={activeJob}
          onStop={handleStop}
        />
        <div className="panel-browser">
          {showPlaceholder && activeJob && <SessionPlaceholder job={activeJob} />}
        </div>
      </div>
    </div>
  );
};
