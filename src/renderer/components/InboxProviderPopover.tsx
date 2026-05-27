/**
 * InboxProviderPopover - small popover anchored to whichever element
 * triggered "add inbox" (the empty-state CTA row, or the section-header
 * `+`). Renders the provider brand logos as tiles - Gmail (clickable),
 * Outlook (disabled, dimmed + "soon"). Logos only at rest; the provider
 * name fades in beneath the logo on hover. MVP supports Gmail only;
 * Outlook ships under the same primitive with no new architecture.
 *
 * Lives in the sidebar zone (renderer chrome, no BrowserView covers it),
 * so no detach-views dance or transient secondary BrowserWindow needed.
 * Closes on backdrop click and on Escape.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import gmailLogo from '../assets/icons/gmail.svg';
import outlookLogo from '../assets/icons/outlook.svg';

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
        type="button"
        className="inbox-tile"
        onClick={() => onPick('gmail')}
        role="menuitem"
        aria-label="Connect Gmail"
        title="Gmail"
      >
        <img src={gmailLogo} alt="" className="inbox-tile__logo" draggable={false} />
        <span className="inbox-tile__label">Gmail</span>
      </button>
      <button
        type="button"
        className="inbox-tile inbox-tile--disabled"
        aria-disabled="true"
        role="menuitem"
        aria-label="Outlook (coming soon)"
        title="Outlook - coming soon"
      >
        <img src={outlookLogo} alt="" className="inbox-tile__logo" draggable={false} />
        <span className="inbox-tile__label">Outlook · soon</span>
      </button>
    </div>,
    document.body,
  );
};
