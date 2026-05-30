import React, { useEffect, useMemo } from 'react';
import type {
  BrowserEvent,
  BrowserJobRow,
  PausedForUserReason,
} from '../../types';
import { deriveDisplayStatus, latestPausedForUser } from '../../types';
import { JorbHeader } from '../../components/JorbHeader';
import { useInboxStatus } from '../../hooks/useInboxStatus';

interface ActionBarProps {
  activeJob: BrowserJobRow | null;
  /** The system tab on top (`__webapp__`, `__inbox_<id>__`), or null
   * when an agent session is active. */
  activeNavId: string | null;
  /** All browser_jobs the renderer knows about. Used by the inbox-tab
   * cross-actor speech branch (C14) to detect any running apply session
   * that is currently `paused_for_user`. */
  sessions: BrowserJobRow[];
  onStop: (jobId: string) => void;
  /** Inbox-access (C13): user clicked Continue in `paused_for_user`. */
  onContinue: (jobId: string) => void;
}

/*
 * Modes drive height + which JorbHeader trailing buttons render.
 *
 *   hidden            -> bar height 0; BrowserView fills middle panel
 *                        (idle, or active __webapp__ tab)
 *   inbox_tab         -> bar height 96; JorbHeader only (no buttons),
 *                        three-way speech derive (reading > cross-actor
 *                        paused > idle)
 *   queued            -> bar height 96; JorbHeader, no buttons
 *   running           -> bar height 96; JorbHeader + Stop
 *   needs_review      -> bar height 96; JorbHeader + Stop (tailor ready)
 *   paused_for_user   -> bar height 96; JorbHeader + Stop + Continue
 *   completed/failed/stopped -> bar height 96; JorbHeader, no buttons
 */
type Mode =
  | 'hidden'
  | 'inbox_tab'
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'paused_for_user'
  | 'completed'
  | 'failed'
  | 'stopped';

const BAR_HEIGHT = 96;
const INBOX_TAB_PREFIX = '__inbox_';

const INBOX_TAB_SPEECH_READING =
  "Reading your inbox right now for a verification code...";
const INBOX_TAB_SPEECH_CROSS_ACTOR_PAUSED =
  "Find the verification code in your inbox, then return to your apply tab to type it in and hit Continue.";
const INBOX_TAB_SPEECH_IDLE =
  "I'll check your inbox for verification codes when you apply.";

/**
 * Inbox-access give_up taxonomy -> tab-agnostic speech variant (C13).
 * Server emits the reason code; renderer owns the speech strings so
 * copy iteration stays in the renderer. Every variant references "your
 * apply form" (NEVER "the form below") because the user often re-reads
 * the speech while on the inbox tab.
 */
const PAUSED_FOR_USER_SPEECH: Record<PausedForUserReason, string> = {
  no_inbox_connected:
    "I can't reach your inbox yet. Click Connect inbox in the sidebar, find the code there, type it into your apply form, then hit Continue.",
  user_not_logged_in:
    "You're signed out of your inbox. Open it from the sidebar to sign back in, find the code, type it into your apply form, then hit Continue.",
  no_matching_email:
    "I checked the inboxes I know about and didn't find a code. Look in your inbox tab, type the code into your apply form, then hit Continue.",
  multiple_candidates_ambiguous:
    "I found multiple possible emails. Check your inbox tab for the right code, type it into your apply form, then hit Continue.",
  email_unreadable:
    "I couldn't parse the verification email. Check your inbox tab, find the code, type it into your apply form, then hit Continue.",
  session_expired_mid_read:
    "Gmail asked me to re-authenticate. Sign in again via the inbox tab in your sidebar, find the code, type it into your apply form, then hit Continue.",
};

const PAUSED_FOR_USER_FALLBACK =
  "I need your help finishing this step. Find the verification code in your inbox, type it into your apply form, then hit Continue.";


/* ── Derivations ──────────────────────────────────────────────────── */

function deriveMode(activeJob: BrowserJobRow | null, activeNavId: string | null): Mode {
  if (activeJob) {
    const status = deriveDisplayStatus(activeJob);
    if (status === 'needs_attention') return 'needs_review';
    if (status === 'paused_for_user') return 'paused_for_user';
    return status as Mode;
  }
  if (activeNavId && activeNavId.startsWith(INBOX_TAB_PREFIX)) {
    return 'inbox_tab';
  }
  return 'hidden';
}

function stripTrailingDots(s: string): string {
  return s.replace(/[\s…]*\.{2,}\s*$/, '').replace(/\s*—\s*$/, '').trim();
}

/** Doc type of the current tailor cycle, newest cycle wins. */
function currentDocType(events: BrowserEvent[]): 'resume' | 'cover_letter' | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'tailor_approved' || e.type === 'resumed') break;
    if (e.type === 'tailor_ready' || e.type === 'paused_for_tailor') {
      return e.doc_type ?? null;
    }
  }
  return null;
}

function deriveJobSpeech(mode: Mode, job: BrowserJobRow): string {
  const events: BrowserEvent[] = job.events || [];
  switch (mode) {
    case 'queued':
      return "You're in the queue. I'll start as soon as a worker is free.";
    case 'needs_review': {
      const t = currentDocType(events);
      const doc = t === 'resume' ? 'resume' : t === 'cover_letter' ? 'cover letter' : 'document';
      return `Your ${doc} is ready. Review it and approve below to continue.`;
    }
    case 'paused_for_user': {
      const paused = latestPausedForUser(job);
      const reason = paused?.reason as PausedForUserReason | undefined;
      if (reason && reason in PAUSED_FOR_USER_SPEECH) {
        return PAUSED_FOR_USER_SPEECH[reason];
      }
      return PAUSED_FOR_USER_FALLBACK;
    }
    case 'completed':
      return "All done. I've submitted your application.";
    case 'failed':
      return "I ran into a problem and couldn't finish this application.";
    case 'stopped':
      return 'Stopped. Start it again whenever you are ready.';
    case 'running':
    default: {
      const last = events[events.length - 1];
      if (!last || !last.message) return 'Booting up, opening the application page.';
      return stripTrailingDots(last.message);
    }
  }
}

/** Inbox-tab three-way speech derive (C14). Reading wins over cross-actor
 * paused; paused wins over idle. */
function deriveInboxTabSpeech(
  inboxId: string,
  reading: boolean,
  sessions: BrowserJobRow[],
): string {
  if (reading) return INBOX_TAB_SPEECH_READING;
  for (const job of sessions) {
    if (job.status !== 'running') continue;
    const paused = latestPausedForUser(job);
    if (paused) return INBOX_TAB_SPEECH_CROSS_ACTOR_PAUSED;
  }
  return INBOX_TAB_SPEECH_IDLE;
  // Note: we deliberately do NOT scope the cross-actor branch to "this
  // specific inbox is the one the EmailAgent was using" - any
  // paused_for_user in flight means the user is in a verification
  // workflow that needs them.
}

function inboxShortIdFromSession(sessionId: string): string {
  return sessionId.slice(INBOX_TAB_PREFIX.length, INBOX_TAB_PREFIX.length + 8);
}


/* ── Component ────────────────────────────────────────────────────── */

export const ActionBar: React.FC<ActionBarProps> = ({
  activeJob,
  activeNavId,
  sessions,
  onStop,
  onContinue,
}) => {
  const mode = deriveMode(activeJob, activeNavId);
  const inboxStatusMap = useInboxStatus();

  // Bar height: hidden -> 0; everything else -> 96. Renderer pushes this
  // to main so BrowserView bounds re-flow under the bar.
  useEffect(() => {
    const h = mode === 'hidden' ? 0 : BAR_HEIGHT;
    // Dev observability: the bar's own decision (what it derived, what height it
    // asked main to reserve). Pair with main's `[Windows] action-bar height` to
    // tell a missing-bar bug apart: no request here -> binding/derive issue;
    // request here but no reserve there -> bounds re-flow issue.
    window.Finbro.debug('bar', `mode=${mode} -> setBarHeight(${h})`);
    window.Finbro.panel.setBarHeight(h);
  }, [mode]);

  const speech = useMemo(() => {
    if (mode === 'inbox_tab' && activeNavId) {
      // The inbox-tab session id encodes only the first 8 chars of the
      // inbox uuid. The reading map is keyed by FULL uuid (server-side
      // emits inbox_status_changed.inbox_id = full uuid). Reverse-lookup
      // by prefix.
      const short = inboxShortIdFromSession(activeNavId);
      let reading = false;
      inboxStatusMap.forEach((v, k) => {
        if (v && k.startsWith(short)) reading = true;
      });
      return deriveInboxTabSpeech(activeNavId, reading, sessions);
    }
    if (activeJob) return deriveJobSpeech(mode, activeJob);
    return '';
  }, [mode, activeJob, activeNavId, sessions, inboxStatusMap]);

  if (mode === 'hidden') return null;

  // Inbox tabs have no buttons (observation-only) - the apply session
  // that's paused is stopped from its own tab.
  if (mode === 'inbox_tab') {
    return (
      <div className="action-bar action-bar--inbox-tab">
        <JorbHeader speech={speech} />
      </div>
    );
  }

  // Stop is offered only while the agent is mid-run, waiting on the
  // user, or paused-for-user. Terminal and not-yet-started jobs have
  // nothing to stop.
  const canStop =
    mode === 'running' || mode === 'needs_review' || mode === 'paused_for_user';
  const canContinue = mode === 'paused_for_user';

  const trailing = (canStop || canContinue) ? (
    <>
      {canStop && (
        <button className="action-bar__stop" onClick={() => onStop(activeJob!.id)}>
          Stop
        </button>
      )}
      {canContinue && (
        <button
          className="action-bar__continue"
          onClick={() => onContinue(activeJob!.id)}
        >
          Continue
        </button>
      )}
    </>
  ) : undefined;

  const barClassName = `action-bar ${mode === 'paused_for_user' ? 'action-bar--paused' : ''}`.trim();

  return (
    <div className={barClassName}>
      <JorbHeader speech={speech} trailing={trailing} />
    </div>
  );
};
