/**
 * useInboxStatus - Map<inbox_id, reading>. Subscribed to
 * `inbox_status_changed` pushes from the server. The EmailAgent fires
 * `reading: true` immediately before `_run_inner_agent` and `reading:
 * false` in its finally; the renderer uses this to render the
 * "Reading your inbox right now for a verification code..." JorbHeader
 * speech on the inbox tab (C14, priority-ordered three-way derive).
 *
 * One reading flag per inbox; default false. Map is shared module-global
 * so multiple components reading the same inbox's flag see identical
 * state.
 */
import { useEffect, useState } from 'react';
import { subscribeInboxStatus } from '../lib/rpc';

let _readingMap = new Map<string, boolean>();
const _subscribers = new Set<(snapshot: Map<string, boolean>) => void>();
let _wired = false;

function _notify(): void {
  // New Map reference so React's setState detects the change.
  const snap = new Map(_readingMap);
  _readingMap = snap;
  _subscribers.forEach((cb) => cb(_readingMap));
}

function _wire(): void {
  if (_wired) return;
  _wired = true;
  subscribeInboxStatus(({ inbox_id, reading }) => {
    if (reading) {
      _readingMap.set(inbox_id, true);
    } else {
      _readingMap.delete(inbox_id);
    }
    _notify();
  });
}

export function useInboxStatus(): Map<string, boolean> {
  _wire();
  const [snapshot, setSnapshot] = useState<Map<string, boolean>>(_readingMap);
  useEffect(() => {
    _subscribers.add(setSnapshot);
    setSnapshot(_readingMap);
    return () => {
      _subscribers.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}

/** Convenience: is THIS inbox currently being read? */
export function useIsInboxReading(inboxId: string): boolean {
  const map = useInboxStatus();
  return map.get(inboxId) === true;
}
