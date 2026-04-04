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
  fetchJobLink,
  enrichBrowserJob,
  getSupabase,
} from '../lib/supabase';
import type { BrowserJobRow, BrowserEvent } from '../types';

initSupabase(
  'https://optsvxrgzocfuyyrbkqd.supabase.co',
  'sb_publishable_bJw9zTxyqsiE83gw8kV6Cw_tXyCXGLc',
);

const RIGHT_MIN = 200;
const RIGHT_MAX = 480;
const RIGHT_DEFAULT = 260;

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

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
      setSupabaseToken(token);
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
        setEvents([]);
      }
    });
    return cleanup;
  }, []);

  // ── Fetch + Realtime subscription for sessions ───────────────────
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    let userChannel: any = null;
    let mounted = true;

    (async () => {
      const jobs = await fetchUserJobs(userId);
      if (!mounted) return;
      setSessions(jobs as BrowserJobRow[]);

      userChannel = subscribeUserJobs(
        userId,
        async (newRow: any) => {
          if (!mounted) return;
          try {
            const enriched = await enrichBrowserJob(newRow);
            if (!mounted) return;
            setSessions((prev) => [enriched as BrowserJobRow, ...prev]);
          } catch {
            setSessions((prev) => [newRow as BrowserJobRow, ...prev]);
          }
          setActiveJobId(newRow.id);
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
    })();

    return () => {
      mounted = false;
      if (userChannel) {
        getSupabase()?.removeChannel(userChannel);
      }
    };
  }, [isAuthenticated, userId]);

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

    const current = sessionsRef.current;
    const hasRunning = current.some((s) => s.status === 'running');
    if (hasRunning) return;

    const job = current.find((s) => s.id === jobId);
    if (job) {
      const link = await fetchJobLink(job.job_id);
      if (link) {
        window.Finbro.panel.navigate(link);
      }
    }
  }, []);

  const handleNavigate = useCallback((url: string) => {
    window.Finbro.panel.navigate(url);
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
          onSelect={handleSelectSession}
          onNavigate={handleNavigate}
        />
      </div>
      <div className="panel-middle">
        <ActionBar activeJob={activeJob} onStop={handleStop} />
      </div>
      <div className="panel-resize-handle" onMouseDown={onResizeStart} />
      <div className="panel-right" style={{ width: rightWidth, minWidth: rightWidth }}>
        <ChatFeed events={events} isRunning={activeJob?.status === 'running'} />
      </div>
    </div>
  );
};
