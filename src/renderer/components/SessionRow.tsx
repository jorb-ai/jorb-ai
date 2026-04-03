import React from 'react';
import { statusBg, statusText } from '../lib/colors';
import type { BrowserJobRow } from '../types';

interface SessionRowProps {
  job: BrowserJobRow;
  isActive: boolean;
  onClick: () => void;
}

export const SessionRow: React.FC<SessionRowProps> = ({ job, isActive, onClick }) => {
  const title = job.title || `Job ${job.job_id.slice(0, 6)}`;
  const company = job.company || null;
  const label = company ? `${title} · ${company}` : title;

  return (
    <div
      className={`session-row ${isActive ? 'session-row--active' : ''}`}
      style={{
        backgroundColor: statusBg[job.status] || statusBg.queued,
        color: statusText[job.status] || statusText.queued,
      }}
      onClick={onClick}
      title={label}
    >
      <span className="session-row__label">{label}</span>
    </div>
  );
};
