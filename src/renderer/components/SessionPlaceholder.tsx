import React from 'react';
import type { BrowserJobRow } from '../types';

interface SessionPlaceholderProps {
  job: BrowserJobRow;
}

function formatJobTitle(job: BrowserJobRow): string {
  const role = job.title || `Job ${job.job_id.slice(0, 6)}`;
  return job.company ? `${job.company} \u2014 ${role}` : role;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Rendered in the middle panel when the active session has no BrowserView
 * attached — queued sessions (worker hasn't claimed yet) or terminal
 * sessions past the 30s grace period (BrowserView destroyed).
 *
 * The main process is told to detach all BrowserViews via
 * `session.showPlaceholder()` so this card is actually visible rather
 * than occluded by an invisible Chromium surface.
 */
export const SessionPlaceholder: React.FC<SessionPlaceholderProps> = ({ job }) => {
  const status = job.status;
  const title = formatJobTitle(job);

  let eyebrowMark: React.ReactNode = null;
  let eyebrowLabel = '';
  let eyebrowClass = 'placeholder__eyebrow--queued';
  let meta = '';
  let body = '';
  let hint: string | null = null;

  switch (status) {
    case 'queued':
      eyebrowMark = <span className="placeholder__queued-dot" aria-hidden />;
      eyebrowLabel = 'Queued';
      eyebrowClass = 'placeholder__eyebrow--queued';
      meta = 'Waiting for worker capacity';
      body = 'Your session will open here the moment a worker claims it. You can keep browsing in the meantime \u2014 nothing is blocked.';
      hint = 'Cap: 5 concurrent sessions';
      break;
    case 'completed':
      eyebrowMark = <span className="placeholder__mark" aria-hidden>{'\u2713'}</span>;
      eyebrowLabel = 'Completed';
      eyebrowClass = 'placeholder__eyebrow--completed';
      meta = job.completed_at ? `Finished ${relativeTime(job.completed_at)}` : 'Finished';
      body = 'The agent finished this application and the portal view has been released. Your tailored documents remain in your library.';
      break;
    case 'failed':
      eyebrowMark = <span className="placeholder__mark" aria-hidden>{'\u0021'}</span>;
      eyebrowLabel = 'Failed';
      eyebrowClass = 'placeholder__eyebrow--failed';
      meta = job.completed_at ? `Stopped ${relativeTime(job.completed_at)}` : 'Stopped';
      body = job.error_message
        ? job.error_message
        : 'The agent ran into an issue and the session has ended. You can retry from the webapp.';
      break;
    case 'stopped':
      eyebrowMark = <span className="placeholder__mark" aria-hidden>{'\u25A0'}</span>;
      eyebrowLabel = 'Stopped';
      eyebrowClass = 'placeholder__eyebrow--stopped';
      meta = job.completed_at ? `Stopped ${relativeTime(job.completed_at)}` : 'Stopped by you';
      body = 'You stopped this session. The portal view has been released.';
      break;
    case 'running':
    default:
      // Should not normally render placeholder for running; guard just in case.
      eyebrowLabel = 'Running';
      meta = 'Starting up';
      body = 'The agent is initializing. This view will swap to the portal in a moment.';
      break;
  }

  return (
    <div className="placeholder">
      <div className="placeholder__card">
        <div className={`placeholder__eyebrow ${eyebrowClass}`}>
          {eyebrowMark}
          {eyebrowLabel}
        </div>
        <div className="placeholder__title">{title}</div>
        {meta && <div className="placeholder__meta">{meta}</div>}
        <div className="placeholder__body">{body}</div>
        {hint && <div className="placeholder__hint">{hint}</div>}
      </div>
    </div>
  );
};
