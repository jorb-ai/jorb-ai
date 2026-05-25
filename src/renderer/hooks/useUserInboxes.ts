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
    const snapshot = inboxes;
    setInboxes((prev) => prev.filter((i) => i.id !== inboxId));
    try {
      await removeUserInbox(inboxId);
    } catch (err) {
      console.error('[useUserInboxes] remove failed, re-listing:', err);
      const fresh = await listUserInboxes();
      setInboxes(fresh);
      // suppress unused-var warning
      void snapshot;
    }
  }, [inboxes]);

  return useMemo(() => ({ inboxes, loading, add, remove }), [inboxes, loading, add, remove]);
}
