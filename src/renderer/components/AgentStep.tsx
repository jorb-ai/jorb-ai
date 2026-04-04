import React from 'react';
import type { BrowserEvent } from '../types';

const STEP_ICONS: Record<string, string> = {
  tool_call: '\u2699',
  status: '\u279C',
  error: '\u2716',
  tailor_approved: '\u2705',
  resumed: '\u25B6',
};

interface AgentStepProps {
  event: BrowserEvent;
  index: number;
}

export const AgentStep: React.FC<AgentStepProps> = ({ event, index }) => {
  return (
    <div
      className={`agent-step agent-step--${event.type}`}
      style={{ animationDelay: `${Math.min(index * 0.04, 0.3)}s` }}
    >
      <span className="agent-step__icon">
        {STEP_ICONS[event.type] || '\u2022'}
      </span>
      <span className="agent-step__text">{event.message}</span>
    </div>
  );
};
