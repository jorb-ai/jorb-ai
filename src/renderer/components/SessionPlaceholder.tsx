import React from 'react';
import type { BrowserJobRow } from '../types';

interface SessionPlaceholderProps {
  job: BrowserJobRow;
}

function formatJobTitle(job: BrowserJobRow): string {
  const role = job.title || `Job ${job.job_id.slice(0, 6)}`;
  return job.company ? `${job.company} — ${role}` : role;
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
 * Rendered in the middle panel when the selected session has no live
 * BrowserView — a `queued` job the worker hasn't navigated yet, or a job
 * from an earlier app run that this instance never opened a tab for.
 *
 * `panels.ts:showSession` returns `false` for such a session and detaches
 * every BrowserView (placeholder mode), so this card is visible rather
 * than occluded by an opaque Chromium surface. App.tsx renders it on the
 * `false` return.
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
      body = 'Your session will open here the moment a worker claims it. You can keep browsing in the meantime — nothing is blocked.';
      hint = 'Cap: 5 concurrent sessions';
      break;
    case 'completed':
      eyebrowMark = <span className="placeholder__mark" aria-hidden>{'✓'}</span>;
      eyebrowLabel = 'Completed';
      eyebrowClass = 'placeholder__eyebrow--completed';
      meta = job.completed_at ? `Finished ${relativeTime(job.completed_at)}` : 'Finished';
      body = 'The agent finished this application. Any documents it tailored remain in your library.';
      break;
    case 'failed':
      eyebrowMark = <span className="placeholder__mark" aria-hidden>{'!'}</span>;
      eyebrowLabel = 'Failed';
      eyebrowClass = 'placeholder__eyebrow--failed';
      meta = job.completed_at ? `Stopped ${relativeTime(job.completed_at)}` : 'Stopped';
      body = job.error_message
        ? job.error_message
        : 'The agent ran into an issue and the session has ended. You can retry from the webapp.';
      break;
    case 'stopped':
      eyebrowMark = <span className="placeholder__mark" aria-hidden>{'■'}</span>;
      eyebrowLabel = 'Stopped';
      eyebrowClass = 'placeholder__eyebrow--stopped';
      meta = job.completed_at ? `Stopped ${relativeTime(job.completed_at)}` : 'Stopped by you';
      body = 'You stopped this session.';
      break;
    case 'running':
    default:
      // A running job normally has a live tab. It won't here if the app
      // was restarted mid-run — the BrowserView is gone and nothing
      // re-creates it. Describe that orphaned case honestly rather than
      // pretending the job is still spinning up.
      eyebrowLabel = 'Running';
      meta = 'No live view in this window';
      body = "This application is running on the server, but its live view isn't open in this window — the app was likely restarted mid-job. Close the row to dismiss it here.";
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
