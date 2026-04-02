import React from 'react';
import type { BrowserJobRow } from '../types';

interface ActionBarProps {
  activeJob: BrowserJobRow | null;
  onStop: () => void;
}

export const ActionBar: React.FC<ActionBarProps> = ({ activeJob, onStop }) => {
  const status = activeJob?.status || 'idle';
  const isRunning = status === 'running';
  const lastEvent = activeJob?.events?.length
    ? activeJob.events[activeJob.events.length - 1]
    : null;

  return (
    <div className="action-bar">
      <div className="action-bar-status">
        <span className={`status-indicator ${status}`} />
        <span className="status-text">
          {lastEvent?.message || (isRunning ? 'Agent working...' : status)}
        </span>
      </div>
      {isRunning && (
        <button className="stop-btn" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
};
