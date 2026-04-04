import React, { useEffect, useState } from 'react';
import { subscribeAgentJob, getSupabase } from '../lib/supabase';
import { StreamingDots } from './StreamingDots';
import { colors } from '../lib/colors';
import type { BrowserEvent, AgentJobEvent } from '../types';

interface TailorThreadProps {
  event: BrowserEvent;
}

export const TailorThread: React.FC<TailorThreadProps> = ({ event }) => {
  const [agentEvents, setAgentEvents] = useState<AgentJobEvent[]>([]);
  const [status, setStatus] = useState<string>('queued');

  const agentJobId = event.agent_job_id;
  const docType = event.doc_type === 'resume' ? 'Resume' : 'Cover Letter';

  useEffect(() => {
    if (!agentJobId) return;

    const channel = subscribeAgentJob(agentJobId, (row: any) => {
      setStatus(row.status || 'running');
      if (row.events) {
        setAgentEvents(row.events);
      }
    });

    return () => {
      if (channel) {
        getSupabase()?.removeChannel(channel);
      }
    };
  }, [agentJobId]);

  const isActive = status === 'queued' || status === 'running';
  const editCount = agentEvents.filter((e) => e.type === 'edit').length;

  return (
    <div className="tailor-thread">
      <div className="tailor-thread__header">
        <span className="tailor-thread__icon">{isActive ? '\u2728' : '\u2705'}</span>
        <span className="tailor-thread__title">
          {isActive ? `Tailoring ${docType}` : `${docType} Tailored`}
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
        {status === 'completed' && (
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
