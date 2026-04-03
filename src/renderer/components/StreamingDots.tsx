import React from 'react';
import { colors } from '../lib/colors';

interface StreamingDotsProps {
  color?: string;
}

export const StreamingDots: React.FC<StreamingDotsProps> = ({ color = colors.brand }) => {
  return (
    <span className="streaming-dots">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="streaming-dots__dot"
          style={{
            backgroundColor: color,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
};
