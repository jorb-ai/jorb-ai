import React from 'react';
import type { BrowserJobRow } from '../types';

interface SessionListProps {
  sessions: BrowserJobRow[];
  activeJobId: string | null;
  onSelect: (jobId: string) => void;
  onNavigateHome: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  queued: '#6b7280',
  running: '#7c3aed',
  completed: '#10b981',
  failed: '#ef4444',
  stopped: '#f59e0b',
};

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeJobId,
  onSelect,
  onNavigateHome,
}) => {
  return (
    <div className="session-list">
      {/* Section 1: Web App nav */}
      <div className="session-list-section">
        <div className="session-list-header">Navigate</div>
        <div className="session-list-items">
          <div className="session-item nav-item" onClick={onNavigateHome}>
            <div className="nav-icon">&#9751;</div>
            <div className="session-info">
              <div className="session-title">jorb.ai</div>
              <div className="session-status">Web App</div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Agent sessions */}
      <div className="session-list-section">
        <div className="session-list-header">Sessions</div>
        <div className="session-list-items">
          {sessions.length === 0 && (
            <div className="session-empty">No sessions yet</div>
          )}
          {sessions.map((job) => (
            <div
              key={job.id}
              className={`session-item ${job.id === activeJobId ? 'active' : ''}`}
              onClick={() => onSelect(job.id)}
            >
              <div
                className="session-status-dot"
                style={{ backgroundColor: STATUS_COLORS[job.status] || '#6b7280' }}
              />
              <div className="session-info">
                <div className="session-title">{job.job_id.slice(0, 8)}...</div>
                <div className="session-status">{job.status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
