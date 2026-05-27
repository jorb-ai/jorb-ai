/**
 * EmailsSection - the sidebar group between Dashboard and Applications.
 *
 * Two states, driven by `useUserInboxes().length`:
 *
 *   length === 0: ONE row `+ Connect inbox` that doubles as the
 *                 affordance. No compact `+` on the section header.
 *                 First-time users need self-documenting affordances;
 *                 a bare `EMAILS  +` is cryptic empty real estate
 *                 (changelog 2026-05-24).
 *
 *   length > 0:   InboxRow per inbox + a compact `+` on the section
 *                 header for adding more.
 *
 * The `+` opens an InboxProviderPopover anchored to the click target.
 * On Gmail pick: optimistic `addUserInbox` (placeholder row appears),
 * popover closes, the new inbox tab is opened so the user signs in to
 * Gmail. On error response, the optimistic row is rolled back.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUserInboxes } from '../../hooks/useUserInboxes';
import { InboxRow, inboxSessionId } from '../../components/InboxRow';
import { InboxProviderPopover } from '../../components/InboxProviderPopover';

interface EmailsSectionProps {
  enabled: boolean;
  activeNavId: string | null;
  onInboxOpen: (sessionId: string) => void;
}

export const EmailsSection: React.FC<EmailsSectionProps> = ({
  enabled,
  activeNavId,
  onInboxOpen,
}) => {
  const { inboxes, loading, add, remove } = useUserInboxes(enabled);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const openPopover = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
  }, []);

  const closePopover = useCallback(() => {
    setAnchorRect(null);
  }, []);

  const handlePick = useCallback(
    async (provider: 'gmail') => {
      setAnchorRect(null);
      const real = await add(provider);
      if (real) {
        const sid = inboxSessionId(real.id);
        // Open the inbox tab so the user signs into Gmail. Default URL
        // is the Gmail root.
        window.Finbro.session.showOrNavigateInbox(sid);
        onInboxOpen(sid);
      }
    },
    [add, onInboxOpen],
  );

  const handleInboxClick = useCallback(
    (uuid: string) => {
      const sid = inboxSessionId(uuid);
      window.Finbro.session.showOrNavigateInbox(sid);
      onInboxOpen(sid);
    },
    [onInboxOpen],
  );

  const handleInboxRemove = useCallback(
    async (uuid: string) => {
      const sid = inboxSessionId(uuid);
      // Tear down the BrowserView immediately to free its RAM. Cookies
      // on disk (persist:inbox_<id>) intentionally stay - cheap MVP
      // trade-off; a future janitor can sweep orphans if needed.
      // See workstreams/browser/shell/inbox-access.md "Not in scope".
      window.Finbro.session.destroy(sid);
      await remove(uuid);
    },
    [remove],
  );

  // Suppress flash-of-CTA-then-rows on cold start by holding the
  // section empty during the very first list fetch.
  const showEmpty = !loading && inboxes.length === 0;
  const showOccupied = inboxes.length > 0;

  // Anchor the popover to its own dedicated trigger when re-opening
  // from the `+` icon after the user already has inboxes.
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // No-op: anchor is captured at click time via getBoundingClientRect.
  }, []);

  return (
    <>
      <div className="sidebar__section">
        <div className="sidebar__header sidebar__header--with-action">
          <span>Emails</span>
          {showOccupied && (
            <button
              ref={plusBtnRef}
              className="sidebar__header-action"
              onClick={openPopover}
              aria-label="Add inbox"
              title="Add inbox"
            >
              {'+'}
            </button>
          )}
        </div>
        {showEmpty && (
          <div className="sidebar__nav-item inbox-connect-cta" onClick={openPopover} role="button">
            <span className="inbox-row__icon" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
            <span className="inbox-row__label">Connect inbox</span>
          </div>
        )}
        {showOccupied && (
          <>
            {inboxes.map((inbox) => {
              const sid = inboxSessionId(inbox.id);
              return (
                <InboxRow
                  key={inbox.id}
                  inbox={inbox}
                  isActive={activeNavId === sid}
                  onClick={() => handleInboxClick(inbox.id)}
                  onRemove={() => handleInboxRemove(inbox.id)}
                />
              );
            })}
          </>
        )}
      </div>
      {anchorRect && (
        <InboxProviderPopover
          anchorRect={anchorRect}
          onPick={handlePick}
          onClose={closePopover}
        />
      )}
    </>
  );
};
