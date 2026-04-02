import React, { useState, useEffect, useCallback } from 'react';
import { SessionList } from './components/SessionList';
import { ActionBar } from './components/ActionBar';
import { ChatFeed } from './components/ChatFeed';
import {
  initSupabase,
  setSupabaseToken,
  subscribeUserJobs,
  subscribeJobEvents,
  fetchUserJobs,
  fetchJobLink,
  getSupabase,
} from './lib/supabase';
import type { BrowserJobRow, BrowserEvent } from './types';

// Initialize Supabase immediately — values are hardcoded in DEFAULT_CONFIG,
// must be ready before any auth token arrives from the BrowserView.
initSupabase(
  'https://optsvxrgzocfuyyrbkqd.supabase.co',
  'sb_publishable_bJw9zTxyqsiE83gw8kV6Cw_tXyCXGLc',
);

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<BrowserJobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Listen for auth token changes from main process
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

  // Fetch initial sessions + subscribe to Realtime when authenticated
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    let userChannel: any = null;

    (async () => {
      const jobs = await fetchUserJobs(userId);
      setSessions(jobs as BrowserJobRow[]);

      userChannel = subscribeUserJobs(
        userId,
        (newRow: any) => {
          setSessions((prev) => [newRow as BrowserJobRow, ...prev]);
          // Auto-select new jobs so the right panel streams immediately
          setActiveJobId(newRow.id);
        },
        (updatedRow: any) => {
          setSessions((prev) =>
            prev.map((s) => (s.id === updatedRow.id ? (updatedRow as BrowserJobRow) : s)),
          );
        },
      );
    })();

    return () => {
      if (userChannel) {
        getSupabase()?.removeChannel(userChannel);
      }
    };
  }, [isAuthenticated, userId]);

  // Subscribe to specific job events when active job changes
  useEffect(() => {
    if (!activeJobId) {
      setEvents([]);
      return;
    }

    // Load current events from sessions state
    const job = sessions.find((s) => s.id === activeJobId);
    setEvents(job?.events || []);

    const channel = subscribeJobEvents(activeJobId, (updatedRow: any) => {
      setEvents(updatedRow.events || []);
      // Also update sessions list
      setSessions((prev) =>
        prev.map((s) => (s.id === updatedRow.id ? (updatedRow as BrowserJobRow) : s)),
      );
    });

    return () => {
      if (channel) {
        getSupabase()?.removeChannel(channel);
      }
    };
  }, [activeJobId]);

  const handleSelectSession = useCallback(async (jobId: string) => {
    setActiveJobId(jobId);

    // Don't navigate if any job is currently running — would break the active agent
    const hasRunning = sessions.some((s) => s.status === 'running');
    if (hasRunning) return;

    // Safe to navigate — no agent active
    const job = sessions.find((s) => s.id === jobId);
    if (job) {
      const link = await fetchJobLink(job.job_id);
      if (link) {
        window.Finbro.panel.navigate(link);
      }
    }
  }, [sessions]);

  const handleNavigateHome = useCallback(() => {
    window.Finbro.panel.navigate('http://localhost:3000');
  }, []);

  const handleStop = useCallback(() => {
    if (activeJobId) {
      window.Finbro.browser.stop(activeJobId);
    }
  }, [activeJobId]);

  const activeJob = sessions.find((s) => s.id === activeJobId) || null;

  return (
    <div className="app-shell">
      <div className="panel-left">
        <SessionList
          sessions={sessions}
          activeJobId={activeJobId}
          onSelect={handleSelectSession}
          onNavigateHome={handleNavigateHome}
        />
      </div>
      <div className="panel-middle">
        <ActionBar activeJob={activeJob} onStop={handleStop} />
        {/* BrowserView occupies the rest — managed by main process */}
      </div>
      <div className="panel-right">
        <ChatFeed events={events} />
      </div>
    </div>
  );
};
