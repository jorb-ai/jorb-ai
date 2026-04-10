import React from 'react';
import { statusBg, statusText } from '../lib/colors';
import type { BrowserJobRow, SessionDisplayStatus } from '../types';
import { deriveDisplayStatus } from '../types';

interface SessionRowProps {
  job: BrowserJobRow;
  isActive: boolean;
  onClick: () => void;
}

function statusLabel(status: SessionDisplayStatus): string | null {
  if (status === 'needs_attention') return '\u26A0';
  return null;
}

export const SessionRow: React.FC<SessionRowProps> = ({ job, isActive, onClick }) => {
  const title = job.title || `Job ${job.job_id.slice(0, 6)}`;
  const company = job.company || null;
  const label = company ? `${title} \u00B7 ${company}` : title;
  const displayStatus = deriveDisplayStatus(job);
  const indicator = statusLabel(displayStatus);

  return (
    <div
      className={`session-row ${isActive ? 'session-row--active' : ''}`}
      style={{
        backgroundColor: statusBg[displayStatus] || statusBg.queued,
        color: statusText[displayStatus] || statusText.queued,
      }}
      onClick={onClick}
      title={label}
    >
      {indicator && <span className="session-row__indicator">{indicator}</span>}
      <span className="session-row__label">{label}</span>
    </div>
  );
};
