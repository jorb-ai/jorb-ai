/**
 * useNavState - viewA navigation state for one session (the action bar's
 * browser-chrome strip). Pulls the current state on mount / session change
 * (nav events may predate the bar), then tracks the main-process push on
 * every did-navigate. Returns null until the first state lands or when no
 * session is given.
 */
import { useEffect, useState } from 'react';
import type { SessionNavState } from '../types';

export function useNavState(sessionId: string | null): SessionNavState | null {
  const [state, setState] = useState<SessionNavState | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setState(null);
      return;
    }
    let mounted = true;
    setState(null);

    window.Finbro.session.getNavState(sessionId).then((s) => {
      if (mounted && s && s.sessionId === sessionId) setState(s);
    });

    const unsubscribe = window.Finbro.session.onNavState((s) => {
      if (mounted && s.sessionId === sessionId) setState(s);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [sessionId]);

  return state;
}
