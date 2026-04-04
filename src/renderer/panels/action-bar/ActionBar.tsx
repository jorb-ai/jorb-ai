import React from 'react';
import { StreamingDots } from '../../components/StreamingDots';
import { colors } from '../../lib/colors';
import type { BrowserJobRow } from '../../types';

interface ActionBarProps {
  activeJob: BrowserJobRow | null;
  onStop: (jobId: string) => void;
}

type Mode = 'idle' | 'running' | 'tailoring';

function deriveMode(job: BrowserJobRow | null): Mode {
  if (!job || job.status !== 'running') return 'idle';
  const events = job.events || [];
  const hasPaused = events.some((e) => e.type === 'paused_for_tailor');
  const hasResumed = events.some((e) => e.type === 'resumed');
  // Tailoring if paused and not yet resumed (count-based for multiple cycles)
  const pauseCount = events.filter((e) => e.type === 'paused_for_tailor').length;
  const resumeCount = events.filter((e) => e.type === 'resumed').length;
  if (hasPaused && pauseCount > resumeCount) return 'tailoring';
  return 'running';
}

function docTypeLabel(events: BrowserJobRow['events']): string {
  const last = [...events].reverse().find((e) => e.type === 'paused_for_tailor');
  if (!last?.doc_type) return 'document';
  return last.doc_type === 'resume' ? 'resume' : 'cover letter';
}

export const ActionBar: React.FC<ActionBarProps> = ({ activeJob, onStop }) => {
  const mode = deriveMode(activeJob);

  return (
    <div className="action-bar">
      <div className="action-bar__content">
        {mode === 'idle' && (
          <span className="action-bar__status action-bar__status--idle">
            {activeJob ? `Status: ${activeJob.status}` : 'No active session'}
          </span>
        )}

        {mode === 'running' && (
          <>
            <span className="action-bar__status action-bar__status--running">
              <span className="action-bar__dot action-bar__dot--running" />
              Agent working
              <StreamingDots color={colors.statusRunning} />
            </span>
            <button
              className="action-bar__stop"
              onClick={() => activeJob && onStop(activeJob.id)}
            >
              Stop
            </button>
          </>
        )}

        {mode === 'tailoring' && activeJob && (
          <>
            <span className="action-bar__status action-bar__status--tailoring">
              <span className="action-bar__dot action-bar__dot--tailoring" />
              Tailoring {docTypeLabel(activeJob.events)}
              <StreamingDots color={colors.brand} />
            </span>
            <button
              className="action-bar__stop"
              onClick={() => onStop(activeJob.id)}
            >
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
};
