/**
 * InboxRow - one row per connected inbox in the sidebar EMAILS group.
 * Visual chrome matches `sidebar__nav-item` (28px, rounded-md, glass-grey
 * hover, gray-100 active). Click is a z-order switch to the inbox tab via
 * `session.showOrNavigateInbox`. X on hover/active triggers soft-remove.
 *
 * Text-only, NO provider icon - sidebar rows are uniform plain rows
 * (sessions and nav items carry no icons either); the provider marks live
 * only in the add-inbox popover. No status indicators (queued/running/etc)
 * - inboxes are sidebar nav, not agent sessions. The inbox tab's own
 * JorbHeader carries the read/idle/cross-actor-paused narration (C14).
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
