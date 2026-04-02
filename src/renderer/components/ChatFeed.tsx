import React, { useEffect, useRef } from 'react';
import type { BrowserEvent } from '../types';

interface ChatFeedProps {
  events: BrowserEvent[];
}

const EVENT_ICONS: Record<string, string> = {
  tool_call: '\u2699',
  status: '\u2192',
  error: '\u26A0',
};

export const ChatFeed: React.FC<ChatFeedProps> = ({ events }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className="chat-feed">
      <div className="chat-feed-header">Activity</div>
      <div className="chat-feed-messages">
        {events.length === 0 && (
          <div className="chat-empty">Waiting for activity...</div>
        )}
        {events.map((event, i) => (
          <div key={`${event.ts}-${i}`} className={`chat-message ${event.type}`}>
            <span className="chat-icon">{EVENT_ICONS[event.type] || '\u2022'}</span>
            <span className="chat-text">{event.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
