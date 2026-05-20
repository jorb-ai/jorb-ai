import React, { useEffect, useMemo } from 'react';
import type { BrowserJobRow, BrowserEvent } from '../../types';
import { deriveDisplayStatus } from '../../types';
import { JorbHeader } from '../../components/JorbHeader';

interface ActionBarProps {
  activeJob: BrowserJobRow | null;
  onStop: (jobId: string) => void;
}

/*
 * The bar is binary: hidden when no agent session is the active tab, or the
 * 96px JorbHeader for every agent-session state. The old 44px collapsed
 * strip is gone; one narrative element is reused across every state.
 */
type Mode =
  | 'hidden'
  | 'queued'
  | 'running'
  | 'needs_review'   // tailor_ready seen: the document is waiting on the user
  | 'completed'
  | 'failed'
  | 'stopped';

const BAR_HEIGHT = 96;

/* ── Derivations ──────────────────────────────────────────────────── */

/*
 * One source of truth: the bar mode is the shared session display status
 * (`deriveDisplayStatus`, also used by the sidebar), with `needs_attention`
 * surfaced as `needs_review` plus a `hidden` case for no active job.
 */
function deriveMode(job: BrowserJobRow | null): Mode {
  if (!job) return 'hidden';
  const status = deriveDisplayStatus(job);
  return status === 'needs_attention' ? 'needs_review' : status;
}

function stripTrailingDots(s: string): string {
  return s.replace(/[\s…]*\.{2,}\s*$/, '').replace(/\s*—\s*$/, '').trim();
}

/** Doc type of the current tailor cycle, newest cycle wins. */
function currentDocType(events: BrowserEvent[]): 'resume' | 'cover_letter' | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'tailor_approved' || e.type === 'resumed') break;
    if (e.type === 'tailor_ready' || e.type === 'paused_for_tailor') {
      return e.doc_type ?? null;
    }
  }
  return null;
}

/*
 * The single line Jorb says in the speech bubble. One JorbHeader carries
 * every state (running narration, the approval ask, the terminal sign-off);
 * the bubble itself never changes color, so the per-state signal lives on
 * the sidebar row, not on Jorb.
 */
function deriveSpeech(mode: Mode, job: BrowserJobRow): string {
  const events: BrowserEvent[] = job.events || [];

  switch (mode) {
    case 'queued':
      return "You're in the queue. I'll start as soon as a worker is free.";
    case 'needs_review': {
      const t = currentDocType(events);
      const doc = t === 'resume' ? 'resume' : t === 'cover_letter' ? 'cover letter' : 'document';
      return `Your ${doc} is ready. Review it and approve below to continue.`;
    }
    case 'completed':
      return "All done. I've submitted your application.";
    case 'failed':
      return "I ran into a problem and couldn't finish this application.";
    case 'stopped':
      return 'Stopped. Start it again whenever you are ready.';
    case 'running':
    default: {
      const last = events[events.length - 1];
      if (!last) return 'Booting up, opening the application page.';
      return stripTrailingDots(last.message);
    }
  }
}

/* ── Component ────────────────────────────────────────────────────── */

export const ActionBar: React.FC<ActionBarProps> = ({ activeJob, onStop }) => {
  const mode = deriveMode(activeJob);

  // Tell main the bar height so BrowserView bounds re-flow under it. The
  // bar is binary now: 0 when hidden, 96 otherwise.
  useEffect(() => {
    window.Finbro.panel.setBarHeight(mode === 'hidden' ? 0 : BAR_HEIGHT);
  }, [mode]);

  const speech = useMemo(
    () => (activeJob ? deriveSpeech(mode, activeJob) : ''),
    [mode, activeJob],
  );

  if (mode === 'hidden' || !activeJob) return null;

  // Stop is offered only while the agent is mid-run or waiting on the user.
  // Terminal and not-yet-started jobs have nothing to stop.
  const canStop = mode === 'running' || mode === 'needs_review';
  const trailing = canStop ? (
    <button className="action-bar__stop" onClick={() => onStop(activeJob.id)}>
      Stop
    </button>
  ) : undefined;

  return (
    <div className="action-bar">
      <JorbHeader speech={speech} trailing={trailing} />
    </div>
  );
};
