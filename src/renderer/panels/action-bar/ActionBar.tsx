import React, { useEffect, useMemo } from 'react';
import type { BrowserJobRow, BrowserEvent } from '../../types';

interface ActionBarProps {
  activeJob: BrowserJobRow | null;
  activeNavId: string | null;
  onStop: (jobId: string) => void;
}

type Mode =
  | 'idle'
  | 'system-tab'
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'stopped';

const COLLAPSED_HEIGHT = 44;
const EXPANDED_HEIGHT = 96;

/* ──────────────────────────────────────────────────────────────────────
   Derivations
   ────────────────────────────────────────────────────────────────────── */

function deriveMode(job: BrowserJobRow | null, navId: string | null): Mode {
  if (!job) return navId ? 'system-tab' : 'idle';
  if (job.status === 'queued')    return 'queued';
  if (job.status === 'completed') return 'completed';
  if (job.status === 'failed')    return 'failed';
  if (job.status === 'stopped')   return 'stopped';
  // running — check for the unpaired paused_for_tailor
  const events = job.events || [];
  let paused = 0;
  let approved = 0;
  for (const e of events) {
    if (e.type === 'paused_for_tailor') paused++;
    else if (e.type === 'tailor_approved') approved++;
  }
  return paused > approved ? 'needs_review' : 'running';
}

function navLabel(id: string | null): string {
  switch (id) {
    case '__webapp__':  return 'Jorb AI';
    case '__gmail__':   return 'Gmail';
    case '__outlook__': return 'Outlook';
    default:            return '';
  }
}

function formatJobTitle(job: BrowserJobRow): string {
  const role = job.title || `Job ${job.job_id.slice(0, 6)}`;
  return job.company ? `${job.company} \u2014 ${role}` : role;
}

function stripTrailingDots(s: string): string {
  return s.replace(/[\s\u2026]*\.{2,}\s*$/, '').replace(/\s*—\s*$/, '').trim();
}

function currentActionFor(mode: Mode, job: BrowserJobRow): { text: string; variant: 'default' | 'attention' | 'danger' } {
  const events = job.events || [];
  const last = events[events.length - 1];

  if (mode === 'needs_review') {
    // Find the unpaired paused_for_tailor's doc_type
    let docType: 'resume' | 'cover_letter' | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'tailor_approved' || e.type === 'resumed') break;
      if (e.type === 'paused_for_tailor') { docType = e.doc_type ?? null; break; }
    }
    const doc = docType === 'resume' ? 'Resume' : docType === 'cover_letter' ? 'Cover letter' : 'Document';
    return { text: `${doc} ready \u2014 review and approve to continue`, variant: 'attention' };
  }

  if (!last) {
    return { text: 'Starting up...', variant: 'default' };
  }

  if (last.type === 'error') {
    return { text: last.message, variant: 'danger' };
  }

  return { text: last.message, variant: 'default' };
}

function deriveTrail(events: BrowserEvent[]): string[] {
  if (!events || events.length <= 1) return [];
  const progress = events
    .slice(0, -1)
    .filter((e) => e.type === 'tool_call' || e.type === 'status' || e.type === 'tailor_approved');
  const out: string[] = [];
  for (let i = progress.length - 1; i >= 0; i--) {
    const clean = stripTrailingDots(progress[i].message);
    if (!clean) continue;
    if (out[out.length - 1] === clean) continue;
    out.push(clean);
    if (out.length === 3) break;
  }
  return out;
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

/* ──────────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────────── */

export const ActionBar: React.FC<ActionBarProps> = ({ activeJob, activeNavId, onStop }) => {
  const mode = deriveMode(activeJob, activeNavId);
  const expanded = mode === 'running' || mode === 'needs_review';
  const attention = mode === 'needs_review';

  // Notify main process of the current bar height so BrowserView bounds
  // stay aligned with what the renderer is showing.
  useEffect(() => {
    window.Finbro.panel.setBarHeight(expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT);
  }, [expanded]);

  const classes = [
    'action-bar',
    expanded ? 'action-bar--expanded' : '',
    attention ? 'action-bar--attention' : '',
  ].filter(Boolean).join(' ');

  if (expanded && activeJob) {
    return <ExpandedBar job={activeJob} mode={mode} onStop={onStop} classes={classes} />;
  }
  return <CollapsedBar mode={mode} job={activeJob} navId={activeNavId} classes={classes} />;
};

/* ──────────────────────────────────────────────────────────────────────
   Collapsed (44px) — system tabs, queued / completed / failed / stopped
   ────────────────────────────────────────────────────────────────────── */

const CollapsedBar: React.FC<{
  mode: Mode;
  job: BrowserJobRow | null;
  navId: string | null;
  classes: string;
}> = ({ mode, job, navId, classes }) => {
  let breadcrumb = '';
  let status: { text: string; variant: 'muted' | 'success' | 'danger' } | null = null;

  switch (mode) {
    case 'idle': {
      breadcrumb = 'Jorb AI';
      break;
    }
    case 'system-tab': {
      breadcrumb = navLabel(navId);
      break;
    }
    case 'queued': {
      if (job) {
        breadcrumb = formatJobTitle(job);
        status = { text: 'Waiting for worker capacity', variant: 'muted' };
      }
      break;
    }
    case 'completed': {
      if (job) {
        breadcrumb = formatJobTitle(job);
        const when = relativeTime(job.completed_at);
        status = { text: `\u2713 Completed${when ? ` ${when}` : ''}`, variant: 'success' };
      }
      break;
    }
    case 'failed': {
      if (job) {
        breadcrumb = formatJobTitle(job);
        const msg = job.error_message ? job.error_message : 'Failed';
        status = { text: `\u0021 ${msg}`, variant: 'danger' };
      }
      break;
    }
    case 'stopped': {
      if (job) {
        breadcrumb = formatJobTitle(job);
        status = { text: 'Stopped', variant: 'muted' };
      }
      break;
    }
  }

  return (
    <div className={classes}>
      <div className="action-bar__collapsed">
        {breadcrumb && <span className="action-bar__breadcrumb">{breadcrumb}</span>}
        {breadcrumb && status && <span className="action-bar__sep">{'\u00B7'}</span>}
        {status && (
          <span className={`action-bar__status-text action-bar__status-text--${status.variant}`}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────
   Expanded (96px) — running and needs_review
   ────────────────────────────────────────────────────────────────────── */

const ExpandedBar: React.FC<{
  job: BrowserJobRow;
  mode: Mode;
  onStop: (jobId: string) => void;
  classes: string;
}> = ({ job, mode, onStop, classes }) => {
  const title = formatJobTitle(job);
  const action = useMemo(() => currentActionFor(mode, job), [mode, job]);
  const trail = useMemo(() => deriveTrail(job.events || []), [job.events]);

  // Fresh key on the action text drives the fade-in animation every time
  // the active event changes.
  const actionKey = `${job.events?.length ?? 0}-${action.text}`;

  return (
    <div className={classes}>
      <div className="action-bar__expanded">
        <div className="action-bar__row-top">
          <span className="action-bar__title">{title}</span>
          <span className="action-bar__live" aria-label="agent active" />
          <button className="action-bar__stop" onClick={() => onStop(job.id)}>
            Stop
          </button>
        </div>
        <div
          key={actionKey}
          className={`action-bar__action action-bar__action-fade ${action.variant === 'attention' ? 'action-bar__action--attention' : ''}`}
        >
          {action.variant === 'default' && (
            <span className="action-bar__action-arrow">{'\u2192'}</span>
          )}
          <span>{action.text}</span>
        </div>
        <div className="action-bar__trail">
          {trail.length === 0 ? (
            <span className="action-bar__trail-item" style={{ color: 'var(--neutral-400)' }}>
              {'\u2014'}
            </span>
          ) : (
            trail.map((item, i) => (
              <span key={`${i}-${item}`} className="action-bar__trail-item">{item}</span>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
