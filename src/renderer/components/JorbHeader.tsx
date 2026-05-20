import React, { useRef, useCallback, useMemo } from 'react';
import jorb1 from '../assets/videos/jorb1.webm';
import jorb2 from '../assets/videos/jorb2.webm';
import jorb3 from '../assets/videos/jorb3.webm';
import jorb4 from '../assets/videos/jorb4.webm';
import jorb5 from '../assets/videos/jorb5.webm';
import jorb6 from '../assets/videos/jorb6.webm';
import jorb7 from '../assets/videos/jorb7.webm';
import jorb8 from '../assets/videos/jorb8.webm';

const VIDEOS: readonly string[] = [jorb1, jorb2, jorb3, jorb4, jorb5, jorb6, jorb7, jorb8];

let deck: string[] = [];
let lastServed: string | null = null;
function reshuffleDeck(): void {
  deck = [...VIDEOS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const top = deck.length - 1;
  if (deck.length > 1 && deck[top] === lastServed) {
    [deck[top], deck[0]] = [deck[0], deck[top]];
  }
}
function pickRandomJorbVideo(): string {
  if (deck.length === 0) reshuffleDeck();
  const pick = deck.pop()!;
  lastServed = pick;
  return pick;
}

interface JorbHeaderProps {
  speech: string;
  trailing?: React.ReactNode;
}

export const JorbHeader: React.FC<JorbHeaderProps> = ({ speech, trailing }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playingRef = useRef(false);
  const videoSrc = useMemo(() => pickRandomJorbVideo(), []);

  const handleEnter = useCallback(() => {
    const video = videoRef.current;
    if (!video || playingRef.current) return;
    playingRef.current = true;
    video.currentTime = 0;
    const onEnd = () => {
      video.currentTime = 0;
      playingRef.current = false;
      video.removeEventListener('ended', onEnd);
    };
    video.addEventListener('ended', onEnd);
    void video.play().catch(() => {
      playingRef.current = false;
    });
  }, []);

  return (
    <div className="jorb-header" onMouseEnter={handleEnter}>
      <div className="jorb-header__avatar">
        <video
          ref={videoRef}
          src={videoSrc}
          muted
          playsInline
          preload="auto"
          className="jorb-header__video"
        />
      </div>
      {/*
        The avatar above must NOT re-mount on speech changes — picking a
        new mascot every time the agent speaks is jittery and distracting.
        The speech bubble below carries an inner element that re-keys on
        the speech text, so only the text re-fires `animate-jorb-enter`
        while the mascot stays put for the lifetime of this mount.
      */}
      <div className="jorb-header__bubble-wrap">
        <div className="jorb-header__glow" aria-hidden />
        <div className="jorb-header__bubble">
          <span className="jorb-header__eyebrow">Jorb</span>
          <p key={speech} className="jorb-header__speech jorb-header__speech--enter">{speech}</p>
        </div>
      </div>
      {trailing && <div className="jorb-header__trailing">{trailing}</div>}
    </div>
  );
};
