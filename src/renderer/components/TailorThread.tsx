import React, { useEffect, useState } from 'react';
import { subscribeAgentJob, getSupabase } from '../lib/supabase';
import { StreamingDots } from './StreamingDots';
import { colors } from '../lib/colors';
import type { BrowserEvent, AgentJobEvent } from '../types';

interface TailorThreadProps {
  event: BrowserEvent;
  onClickReview?: () => void;
}

export const TailorThread: React.FC<TailorThreadProps> = ({ event, onClickReview }) => {
  const [agentEvents, setAgentEvents] = useState<AgentJobEvent[]>([]);
  const [status, setStatus] = useState<string>('queued');
  const [isApproved, setIsApproved] = useState(false);

  const agentJobId = event.agent_job_id;
  const docType = event.doc_type === 'resume' ? 'Resume' : 'Cover Letter';

  useEffect(() => {
    if (!agentJobId) return;

    const channel = subscribeAgentJob(agentJobId, (row: any) => {
      setStatus(row.status || 'running');
      if (row.events) {
        setAgentEvents(row.events);
      }
      if (row.is_approved) {
        setIsApproved(true);
      }
    });

    return () => {
      if (channel) {
        getSupabase()?.removeChannel(channel);
      }
    };
  }, [agentJobId]);

  const isActive = status === 'queued' || status === 'running';
  const isComplete = status === 'completed';
  const editCount = agentEvents.filter((e) => e.type === 'edit').length;
  const needsReview = isComplete && !isApproved;

  return (
    <div
      className={`tailor-thread ${needsReview ? 'tailor-thread--reviewable' : ''}`}
      onClick={needsReview && onClickReview ? onClickReview : undefined}
    >
      <div className="tailor-thread__header">
        <span className="tailor-thread__icon">
          {isApproved ? '\u2705' : isActive ? '\u2728' : '\u26A0'}
        </span>
        <span className="tailor-thread__title">
          {isApproved
            ? `${docType} Approved`
            : isActive
              ? `Tailoring ${docType}`
              : needsReview
                ? `${docType} Ready — Click to Review`
                : `${docType} Tailored`}
        </span>
        {isActive && <StreamingDots color={colors.brand} />}
      </div>
      <div className="tailor-thread__body">
        {status === 'queued' && (
          <span className="tailor-thread__step">Waiting for worker...</span>
        )}
        {agentEvents.filter((e) => e.type === 'base_selected').map((e, i) => (
          <span key={`base-${i}`} className="tailor-thread__step">
            Selected base: {e.base_name}
          </span>
        ))}
        {editCount > 0 && (
          <span className="tailor-thread__step">
            {isActive ? `${editCount} edit${editCount !== 1 ? 's' : ''} so far...` : `${editCount} edit${editCount !== 1 ? 's' : ''} applied`}
          </span>
        )}
        {isComplete && !isApproved && (
          <span className="tailor-thread__step tailor-thread__step--review">
            Awaiting your approval
          </span>
        )}
        {isApproved && (
          <span className="tailor-thread__step tailor-thread__step--done">
            Generating PDF...
          </span>
        )}
        {status === 'failed' && (
          <span className="tailor-thread__step tailor-thread__step--error">
            Tailoring failed
          </span>
        )}
      </div>
    </div>
  );
};
