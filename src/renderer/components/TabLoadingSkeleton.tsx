import React from 'react';

/**
 * Rendered in the middle panel while the active tab's BrowserView has not
 * completed its first load — `panels.ts` keeps every view detached
 * (skeleton mode) until `did-finish-load`, so this shows through instead
 * of a blank white view or a held stale tab. Structure mirrors a generic
 * page mid-load: top chrome bar, then a centred content column.
 */
export const TabLoadingSkeleton: React.FC = () => (
  <div className="skeleton">
    <div className="skeleton__topbar">
      <div className="skeleton__bone skeleton__logo" />
      <div className="skeleton__nav">
        <div className="skeleton__bone skeleton__navitem" />
        <div className="skeleton__bone skeleton__navitem" />
        <div className="skeleton__bone skeleton__navitem" />
      </div>
      <div className="skeleton__bone skeleton__avatar" />
    </div>
    <div className="skeleton__page">
      <div className="skeleton__bone skeleton__h1" />
      <div className="skeleton__bone skeleton__meta" />
      <div className="skeleton__lines">
        <div className="skeleton__bone skeleton__line" style={{ width: '100%' }} />
        <div className="skeleton__bone skeleton__line" style={{ width: '94%' }} />
        <div className="skeleton__bone skeleton__line" style={{ width: '98%' }} />
        <div className="skeleton__bone skeleton__line" style={{ width: '62%' }} />
      </div>
      <div className="skeleton__bone skeleton__block" />
      <div className="skeleton__lines">
        <div className="skeleton__bone skeleton__line" style={{ width: '91%' }} />
        <div className="skeleton__bone skeleton__line" style={{ width: '97%' }} />
        <div className="skeleton__bone skeleton__line" style={{ width: '72%' }} />
      </div>
    </div>
  </div>
);
