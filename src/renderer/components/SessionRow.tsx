import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserJobRow, SessionDisplayStatus } from '../types';
import { deriveDisplayStatus } from '../types';

interface SessionRowProps {
  job: BrowserJobRow;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

function formatLabel(job: BrowserJobRow): string {
  const role = job.title || `Job ${job.job_id.slice(0, 6)}`;
  const company = job.company;
  // Company-first reads more naturally ("Stripe — Software Engineer") and
  // matches how job listings are usually titled outside our own data model.
  return company ? `${company} — ${role}` : role;
}

function modifierClass(status: SessionDisplayStatus): string {
  switch (status) {
    case 'queued':    return 'session-row--queued';
    case 'stopped':   return 'session-row--stopped';
    case 'completed': return 'session-row--completed';
    case 'failed':    return 'session-row--failed';
    case 'running':   return 'session-row--running';
    case 'needs_attention':
      // Has its own breathing-dot signal; no gleam-sweep so the two
      // motion treatments don't fight each other on the same row.
      return '';
    default:          return '';
  }
}

export const SessionRow: React.FC<SessionRowProps> = ({ job, isActive, onClick, onClose }) => {
  const display = deriveDisplayStatus(job);
  const label = formatLabel(job);

  const rowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Re-measure overflow whenever the rendered label might have changed
  // (label text or row geometry — sidebar resize would re-render). The
  // X button collapses the available label width when visible, so we
  // measure with the label in its widest layout and trust the visible
  // truncation to mirror that.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, [label, isActive]);

  // Update the cached rect on hover so the tooltip follows the row even
  // if the sidebar has scrolled since last render.
  const handleEnter = () => {
    if (rowRef.current) setRect(rowRef.current.getBoundingClientRect());
    setHovered(true);
  };
  const handleLeave = () => setHovered(false);

  // If the row scrolls while hovered, refresh the rect on the next frame
  // so the tooltip stays aligned. Cheap — fires only while hovered.
  useEffect(() => {
    if (!hovered) return;
    let raf = 0;
    const update = () => {
      if (rowRef.current) setRect(rowRef.current.getBoundingClientRect());
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [hovered]);

  // Close is ALWAYS reachable — on hover or while active — regardless of
  // status. Closing a session is a deliberate, forceful, irreversible
  // action the user must always be able to take, including on a job that
  // needs attention or is mid-run. (A `needs_attention` job that can't be
  // stopped — e.g. orphaned by a server restart — has close as its only
  // escape, so the button must never be hidden.)
  const showCloseBtn = hovered || isActive;
  // Attention dot is the "look here, this session needs you" signal. It
  // yields the right-edge slot to the close button whenever that shows
  // (hover or active), so the dot and the × never collide.
  const showAttentionDot = display === 'needs_attention' && !isActive && !hovered;
  const showTooltip = hovered && overflowing && rect;

  return (
    <>
      <div
        ref={rowRef}
        className={`session-row ${isActive ? 'session-row--active' : ''} ${modifierClass(display)}`.trim()}
        onClick={onClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        role="button"
      >
        <span ref={labelRef} className="session-row__label">{label}</span>
        {showAttentionDot && (
          <span className="session-row__mark session-row__mark--attention" aria-label="needs attention" />
        )}
        {showCloseBtn && (
          <button
            className="session-row__close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close session"
            title="Close session"
          >
            {'×'}
          </button>
        )}
      </div>
      {showTooltip && createPortal(
        <div
          className="session-row__tooltip"
          style={{
            top: rect.bottom + 6,
            left: rect.left,
            // The BrowserView to the right is a NATIVE Chromium layer
            // rendered above HTML — no z-index can put the tooltip on
            // top of it. So the tooltip MUST stay fully inside the
            // sidebar zone, which ends right at the BrowserView
            // boundary. The cap of 186 = 190 (sidebar zone width, see
            // `--sidebar-zone-width` / `SIDEBAR_ZONE_WIDTH` in
            // `windows.ts`) − 4 (breathing margin so the drop shadow
            // doesn't get clipped by the BrowserView edge). Keep this
            // in sync if the sidebar zone width ever changes.
            // The tooltip's text wraps (white-space: normal) so long
            // labels span multiple lines instead of getting clipped.
            maxWidth: Math.max(120, 186 - rect.left),
          }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
};
