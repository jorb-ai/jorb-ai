import React from 'react';
import { SessionRow } from '../../components/SessionRow';
import { colors } from '../../lib/colors';
import type { BrowserJobRow } from '../../types';
import logoWordmark from '../../assets/logos/logo_wordmark.png';

interface SessionListProps {
  sessions: BrowserJobRow[];
  activeJobId: string | null;
  onSelect: (jobId: string) => void;
  onNavigate: (url: string) => void;
}

const LEGEND = [
  { color: colors.statusRunning, label: 'Active' },
  { color: colors.statusCompleted, label: 'Done' },
  { color: colors.statusFailed, label: 'Failed' },
  { color: colors.statusQueued, label: 'Queued' },
];

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeJobId,
  onSelect,
  onNavigate,
}) => {
  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sidebar__brand" onClick={() => onNavigate('http://localhost:3000')}>
        <img src={logoWordmark} alt="Jorb" className="sidebar__wordmark" />
      </div>

      {/* Dashboard */}
      <div className="sidebar__section">
        <div className="sidebar__header">Dashboard</div>
        <div className="sidebar__nav-item" onClick={() => onNavigate('http://localhost:3000')}>
          Jorb AI Web App
        </div>
      </div>

      {/* Emails */}
      <div className="sidebar__section">
        <div className="sidebar__header">Emails</div>
        <div className="sidebar__nav-item" onClick={() => onNavigate('https://mail.google.com')}>
          Gmail
        </div>
        <div className="sidebar__nav-item" onClick={() => onNavigate('https://outlook.live.com')}>
          Outlook
        </div>
      </div>

      {/* Applications */}
      <div className="sidebar__section sidebar__section--grow">
        <div className="sidebar__header">
          Applications
          {sessions.length > 0 && (
            <span className="sidebar__badge">{sessions.length}</span>
          )}
        </div>
        <div className="sidebar__list">
          {sessions.length === 0 ? (
            <div className="sidebar__empty">No applications yet</div>
          ) : (
            sessions.map((job) => (
              <SessionRow
                key={job.id}
                job={job}
                isActive={job.id === activeJobId}
                onClick={() => onSelect(job.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Legend — single row */}
      <div className="sidebar__legend">
        {LEGEND.map((item) => (
          <div key={item.label} className="sidebar__legend-item">
            <span className="sidebar__legend-dot" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
