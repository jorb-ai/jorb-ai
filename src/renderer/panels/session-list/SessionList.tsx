import React from 'react';
import { SessionRow } from '../../components/SessionRow';
import type { BrowserJobRow } from '../../types';
import logoWordmark from '../../assets/logos/logo_wordmark.png';

interface SessionListProps {
  sessions: BrowserJobRow[];
  activeJobId: string | null;
  onSelect: (jobId: string) => void;
  onNavigate: (url: string, sessionId?: string) => void;
  onClose: (jobId: string) => void;
  activeNavId?: string | null;
}

interface NavItem {
  key: string;
  label: string;
  url: string;
  sessionId: string;
}

const NAV_DASHBOARD: NavItem[] = [
  { key: 'webapp',  label: 'Jorb AI Web',  url: 'http://localhost:3000',   sessionId: '__webapp__' },
];

const NAV_EMAIL: NavItem[] = [
  { key: 'gmail',   label: 'Gmail',        url: 'https://mail.google.com',  sessionId: '__gmail__' },
  { key: 'outlook', label: 'Outlook',      url: 'https://outlook.live.com', sessionId: '__outlook__' },
];

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeJobId,
  onSelect,
  onNavigate,
  onClose,
  activeNavId,
}) => {
  const renderNavItem = (item: NavItem) => (
    <div
      key={item.key}
      className={`sidebar__nav-item ${activeNavId === item.sessionId ? 'sidebar__nav-item--active' : ''}`.trim()}
      onClick={() => onNavigate(item.url, item.sessionId)}
    >
      {item.label}
    </div>
  );

  return (
    <div className="sidebar">
      {/* Brand mark — wordmark logo, matches web-app Logo.tsx */}
      <div
        className="sidebar__brand"
        onClick={() => onNavigate('http://localhost:3000', '__webapp__')}
      >
        <img src={logoWordmark} alt="jorb.ai" className="sidebar__logo" />
      </div>

      <div className="sidebar__sections">
        {/* Dashboard */}
        <div className="sidebar__section">
          <div className="sidebar__header">Dashboard</div>
          {NAV_DASHBOARD.map(renderNavItem)}
        </div>

        {/* Emails */}
        <div className="sidebar__section">
          <div className="sidebar__header">Emails</div>
          {NAV_EMAIL.map(renderNavItem)}
        </div>

        {/* Applications — the live session list */}
        <div className="sidebar__section sidebar__section--grow">
          <div className="sidebar__header">Applications</div>
          <div className="sidebar__list">
            {sessions.length === 0 ? (
              <div className="sidebar__empty">No applications yet.</div>
            ) : (
              sessions.map((job) => (
                <SessionRow
                  key={job.id}
                  job={job}
                  isActive={job.id === activeJobId}
                  onClick={() => onSelect(job.id)}
                  onClose={() => onClose(job.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
