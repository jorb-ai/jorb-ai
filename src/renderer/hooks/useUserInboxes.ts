/**
 * useUserInboxes - WS-backed inbox list. One-shot fetch on mount.
 * Optimistic add (placeholder → real row on response, removed on error).
 * Soft-remove via removeUserInbox.
 *
 * Multi-device sync is not addressed in v1 (no server-side pubsub of
 * user_inboxes changes); a re-mount or app reopen re-fetches via the
 * one-shot list call.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listUserInboxes,
  addUserInbox,
  removeUserInbox,
} from '../lib/rpc';
import { inboxSessionId } from '../components/InboxRow';
import type { UserInbox } from '../types';

export interface UseUserInboxes {
  inboxes: UserInbox[];
  loading: boolean;
  add: (provider: 'gmail') => Promise<UserInbox | null>;
  remove: (inboxId: string) => Promise<void>;
}

export function useUserInboxes(enabled: boolean): UseUserInboxes {
  const [inboxes, setInboxes] = useState<UserInbox[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setInboxes([]);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    listUserInboxes().then((rows) => {
      if (!mounted) return;
      setInboxes(rows);
      setLoading(false);
      // Eager preload: warm every inbox BrowserView at Gmail root in the
      // background, so the first sidebar click and the first OTP retrieval
      // land on a painted inbox instead of paying the cold redirect-chain
      // load at the moment of need. Fire-and-forget; main logs outcomes.
      // The add() path needs no preload - its caller opens the tab
      // immediately for Gmail sign-in.
      // .catch: the main-side handler never rejects (preloadInbox swallows
      // internally), so this only guards an IPC transport blip from surfacing
      // as an unhandled rejection in the renderer console.
      rows.forEach((r) => {
        void window.Finbro.session.preloadInbox(inboxSessionId(r.id)).catch(() => {});
      });
    });
    return () => {
      mounted = false;
    };
  }, [enabled]);

  const add = useCallback(async (provider: 'gmail'): Promise<UserInbox | null> => {
    // Optimistic placeholder so the row appears instantly. Replaced or
    // rolled back when the server responds.
    const tempId = `__pending_${Math.random().toString(36).slice(2, 10)}__`;
    const placeholder: UserInbox = {
      id: tempId,
      provider,
      label: provider === 'gmail' ? 'Gmail' : provider,
      created_at: new Date().toISOString(),
    };
    setInboxes((prev) => [...prev, placeholder]);

    try {
      const real = await addUserInbox(provider);
      setInboxes((prev) => prev.map((i) => (i.id === tempId ? real : i)));
      return real;
    } catch (err) {
      console.error('[useUserInboxes] add failed:', err);
      setInboxes((prev) => prev.filter((i) => i.id !== tempId));
      return null;
    }
  }, []);

  const remove = useCallback(async (inboxId: string): Promise<void> => {
    // Optimistic local remove. If the server rejects (rare - ownership
    // would be the only failure mode), we reseed from a re-list.
    setInboxes((prev) => prev.filter((i) => i.id !== inboxId));
    try {
      await removeUserInbox(inboxId);
    } catch (err) {
      console.error('[useUserInboxes] remove failed, re-listing:', err);
      const fresh = await listUserInboxes();
      setInboxes(fresh);
    }
  }, []);

  return useMemo(() => ({ inboxes, loading, add, remove }), [inboxes, loading, add, remove]);
}
