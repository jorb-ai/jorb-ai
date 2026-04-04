import React, { useEffect, useRef } from 'react';
import { AgentStep } from '../../components/AgentStep';
import { TailorThread } from '../../components/TailorThread';
import { StreamingDots } from '../../components/StreamingDots';
import type { BrowserEvent } from '../../types';

interface ChatFeedProps {
  events: BrowserEvent[];
  isRunning?: boolean;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({ events, isRunning = false }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const showStreaming = isRunning && lastEvent?.type !== 'error' && lastEvent?.type !== 'paused_for_tailor';

  return (
    <div className="chat-feed">
      <div className="chat-feed-header">
        <span>Agent</span>
        {showStreaming && <StreamingDots />}
      </div>
      <div className="chat-feed-messages">
        {events.length === 0 && !isRunning && (
          <div className="chat-empty">
            Select an application to view agent activity
          </div>
        )}
        {events.length === 0 && isRunning && (
          <div className="chat-empty chat-empty--waiting">
            Agent is starting up...
          </div>
        )}
        {events.map((event, i) => {
          if (event.type === 'paused_for_tailor') {
            return <TailorThread key={`${event.ts}-${i}`} event={event} />;
          }
          if (event.type === 'tailor_approved' || event.type === 'resumed') {
            return null;
          }
          return <AgentStep key={`${event.ts}-${i}`} event={event} index={i} />;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
