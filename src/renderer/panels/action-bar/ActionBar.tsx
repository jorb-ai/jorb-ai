import React, { useEffect, useMemo } from 'react';
import type { BrowserJobRow, BrowserEvent } from '../../types';
import { JorbHeader } from '../../components/JorbHeader';

interface ActionBarProps {
  activeJob: BrowserJobRow | null;
  onStop: (jobId: string) => void;
}

type Mode =
  | 'hidden'        // no active agent session — bar disappears
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'stopped';

const COLLAPSED_HEIGHT = 44;
const EXPANDED_HEIGHT = 96;

/* ── Derivations ──────────────────────────────────────────────────── */

function deriveMode(job: BrowserJobRow | null): Mode {
  if (!job) return 'hidden';
  if (job.status === 'queued')    return 'queued';
  if (job.status === 'completed') return 'completed';
  if (job.status === 'failed')    return 'failed';
  if (job.status === 'stopped')   return 'stopped';
  const events = job.events || [];
  let paused = 0, approved = 0;
  for (const e of events) {
    if (e.type === 'paused_for_tailor') paused++;
    else if (e.type === 'tailor_approved') approved++;
  }
  return paused > approved ? 'needs_review' : 'running';
}

function formatJobTitle(job: BrowserJobRow): string {
  const role = job.title || `Job ${job.job_id.slice(0, 6)}`;
  return job.company ? `${job.company} — ${role}` : role;
}

function stripTrailingDots(s: string): string {
  return s.replace(/[\s…]*\.{2,}\s*$/, '').replace(/\s*—\s*$/, '').trim();
}

interface Speech {
  text: string;
  variant: 'default' | 'attention' | 'danger';
}

/**
 * The single line Jorb says in the speech bubble.
 *
 * Phase 5.2 collapses the old three-line strip (title / current action /
 * trail) into one user-visible message at a time. Priority order from
 * top to bottom — first matching wins.
 */
function deriveSpeech(mode: Mode, job: BrowserJobRow): Speech {
  const events: BrowserEvent[] = job.events || [];

  if (mode === 'needs_review') {
    let docType: 'resume' | 'cover_letter' | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'tailor_approved' || e.type === 'resumed') break;
      if (e.type === 'paused_for_tailor') { docType = e.doc_type ?? null; break; }
    }
    const doc = docType === 'resume' ? 'resume' : docType === 'cover_letter' ? 'cover letter' : 'document';
    return { text: `Your ${doc} is ready — review and approve to continue.`, variant: 'attention' };
  }

  const last = events[events.length - 1];
  if (!last) {
    return { text: 'Booting up — opening the application page.', variant: 'default' };
  }
  if (last.type === 'error') {
    return { text: stripTrailingDots(last.message), variant: 'danger' };
  }
  return { text: stripTrailingDots(last.message), variant: 'default' };
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Component ────────────────────────────────────────────────────── */

export const ActionBar: React.FC<ActionBarProps> = ({ activeJob, onStop }) => {
  const mode = deriveMode(activeJob);
  const expanded = mode === 'running' || mode === 'needs_review';
  const attention = mode === 'needs_review';

  // Tell main the current bar height every time it changes so
  // BrowserView bounds re-flow and the browser area stays flush.
  useEffect(() => {
    const h = mode === 'hidden' ? 0 : (expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT);
    window.Finbro.panel.setBarHeight(h);
  }, [mode, expanded]);

  if (mode === 'hidden') return null;

  const classes = [
    'action-bar',
    expanded ? 'action-bar--expanded' : '',
    attention ? 'action-bar--attention' : '',
  ].filter(Boolean).join(' ');

  if (expanded && activeJob) {
    return <ExpandedBar job={activeJob} mode={mode} onStop={onStop} classes={classes} />;
  }
  if (activeJob) {
    return <CollapsedBar mode={mode} job={activeJob} classes={classes} />;
  }
  return null;
};

/* ── Collapsed (44px) — queued / completed / failed / stopped ─────── */

const CollapsedBar: React.FC<{
  mode: Mode;
  job: BrowserJobRow;
  classes: string;
}> = ({ mode, job, classes }) => {
  const breadcrumb = formatJobTitle(job);
  let status: { text: string; variant: 'muted' | 'success' | 'danger' } | null = null;

  if (mode === 'queued') {
    status = { text: 'Waiting for worker capacity', variant: 'muted' };
  } else if (mode === 'completed') {
    const when = relativeTime(job.completed_at);
    status = { text: `✓ Completed${when ? ` ${when}` : ''}`, variant: 'success' };
  } else if (mode === 'failed') {
    status = { text: `! ${job.error_message || 'Failed'}`, variant: 'danger' };
  } else if (mode === 'stopped') {
    status = { text: 'Stopped', variant: 'muted' };
  }

  return (
    <div className={classes}>
      <div className="action-bar__collapsed">
        <span className="action-bar__breadcrumb">{breadcrumb}</span>
        {status && <span className="action-bar__sep">{'·'}</span>}
        {status && (
          <span className={`action-bar__status-text action-bar__status-text--${status.variant}`}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
};

/* ── Expanded (96px) — JorbHeader ─────────────────────────────────── */

const ExpandedBar: React.FC<{
  job: BrowserJobRow;
  mode: Mode;
  onStop: (jobId: string) => void;
  classes: string;
}> = ({ job, mode, onStop, classes }) => {
  const speech = useMemo(() => deriveSpeech(mode, job), [mode, job]);

  const stopButton = (
    <button className="action-bar__stop" onClick={() => onStop(job.id)}>
      Stop
    </button>
  );

  // No `key` here — re-keying the JorbHeader would re-roll the mascot
  // every time Jorb says something new, which is visually jittery. The
  // mascot picks once per mount; only the speech-bubble text re-animates
  // (handled by an inner `key={speech}` inside JorbHeader).
  return (
    <div className={classes}>
      <div className="action-bar__expanded">
        <JorbHeader
          speech={speech.text}
          variant={speech.variant}
          trailing={stopButton}
        />
      </div>
    </div>
  );
};
