/**
 * InboxRow - one row per connected inbox in the sidebar EMAILS group.
 * Visual chrome matches `sidebar__nav-item` (28px, rounded-md, gray-100
 * hover/active). Click is a z-order switch to the inbox tab via
 * `session.showOrNavigateInbox`. X on hover/active triggers soft-remove.
 *
 * No status indicators (queued/running/etc) - inboxes are sidebar nav,
 * not agent sessions. The inbox tab's own JorbHeader carries the
 * read/idle/cross-actor-paused narration (C14).
 */
import React, { useState } from 'react';
import type { UserInbox } from '../types';

const INBOX_SESSION_PREFIX = '__inbox_';
const INBOX_SESSION_SUFFIX = '__';

export function inboxSessionId(inboxUuid: string): string {
  // Mirror panels.ts / email_agent.py exactly. C12.
  return INBOX_SESSION_PREFIX + inboxUuid.slice(0, 8) + INBOX_SESSION_SUFFIX;
}

interface InboxRowProps {
  inbox: UserInbox;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}

export const InboxRow: React.FC<InboxRowProps> = ({ inbox, isActive, onClick, onRemove }) => {
  const [hovered, setHovered] = useState(false);
  const label = inbox.label || (inbox.provider === 'gmail' ? 'Gmail' : inbox.provider);
  const showCloseBtn = hovered || isActive;
  const isPending = inbox.id.startsWith('__pending_');

  return (
    <div
      className={`sidebar__nav-item inbox-row ${isActive ? 'sidebar__nav-item--active' : ''} ${isPending ? 'inbox-row--pending' : ''}`.trim()}
      onClick={() => {
        if (!isPending) onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
    >
      <span className="inbox-row__icon" aria-hidden>
        {/* Plain lucide-mail glyph as SVG to avoid pulling lucide-react in. */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      </span>
      <span className="inbox-row__label">{label}</span>
      {showCloseBtn && !isPending && (
        <button
          className="session-row__close"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Disconnect inbox"
          title="Disconnect inbox"
        >
          {'×'}
        </button>
      )}
    </div>
  );
};
