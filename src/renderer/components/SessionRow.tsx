import React from 'react';
import type { BrowserJobRow, SessionDisplayStatus } from '../types';
import { deriveDisplayStatus } from '../types';

interface SessionRowProps {
  job: BrowserJobRow;
  isActive: boolean;
  onClick: () => void;
}

function formatLabel(job: BrowserJobRow): string {
  const role = job.title || `Job ${job.job_id.slice(0, 6)}`;
  const company = job.company;
  // Company-first reads more naturally ("Stripe — Software Engineer") and
  // matches how job listings are usually titled outside our own data model.
  return company ? `${company} \u2014 ${role}` : role;
}

function modifierClass(status: SessionDisplayStatus): string {
  switch (status) {
    case 'queued':    return 'session-row--queued';
    case 'stopped':   return 'session-row--stopped';
    default:          return '';
  }
}

export const SessionRow: React.FC<SessionRowProps> = ({ job, isActive, onClick }) => {
  const display = deriveDisplayStatus(job);
  const label = formatLabel(job);

  return (
    <div
      className={`session-row ${isActive ? 'session-row--active' : ''} ${modifierClass(display)}`.trim()}
      onClick={onClick}
      title={label}
      role="button"
    >
      <span className="session-row__label">{label}</span>
      {display === 'needs_attention' && (
        <span className="session-row__mark session-row__mark--attention" aria-label="needs attention" />
      )}
      {display === 'completed' && (
        <span className="session-row__mark session-row__mark--success" aria-label="completed">{'\u2713'}</span>
      )}
      {display === 'failed' && (
        <span className="session-row__mark session-row__mark--danger" aria-label="failed">{'\u0021'}</span>
      )}
    </div>
  );
};
