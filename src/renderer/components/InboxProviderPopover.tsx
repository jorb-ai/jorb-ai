/**
 * InboxProviderPopover - small popover anchored to whichever element
 * triggered "add inbox" (the empty-state CTA row, or the section-header
 * `+`). Renders Gmail (clickable) and Outlook (disabled, "soon"). MVP
 * supports Gmail only; Outlook ships under the same primitive with no
 * new architecture.
 *
 * Lives in the sidebar zone (renderer chrome, no BrowserView covers it),
 * so no detach-views dance or transient secondary BrowserWindow needed.
 * Closes on backdrop click and on Escape.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface InboxProviderPopoverProps {
  anchorRect: DOMRect;
  onPick: (provider: 'gmail') => void;
  onClose: () => void;
}

export const InboxProviderPopover: React.FC<InboxProviderPopoverProps> = ({
  anchorRect,
  onPick,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    // Defer one tick so the click that opened the popover doesn't
    // immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocClick);
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
      window.clearTimeout(id);
    };
  }, [onClose]);

  // Anchor below the trigger, left-aligned. Cap so it stays inside the
  // sidebar zone (BrowserViews render above HTML so the popover MUST
  // stay over the sidebar's renderer chrome area).
  const top = anchorRect.bottom + 6;
  const left = Math.max(8, anchorRect.left);

  return createPortal(
    <div
      ref={popoverRef}
      className="inbox-popover"
      style={{ top, left }}
      role="menu"
    >
      <button
        className="inbox-popover__item"
        onClick={() => onPick('gmail')}
        role="menuitem"
      >
        <span className="inbox-popover__icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </span>
        Gmail
      </button>
      <button
        className="inbox-popover__item inbox-popover__item--disabled"
        disabled
        role="menuitem"
      >
        <span className="inbox-popover__icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </span>
        Outlook
        <span className="inbox-popover__soon">soon</span>
      </button>
    </div>,
    document.body,
  );
};
