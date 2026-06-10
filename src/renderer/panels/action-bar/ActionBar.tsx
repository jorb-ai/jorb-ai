import React, { useEffect, useMemo, useState } from 'react';
import type {
  BrowserEvent,
  BrowserJobRow,
  PausedForUserReason,
} from '../../types';
import {
  deriveDisplayStatus,
  latestPausedForUser,
  OTP_PAUSED_REASONS,
} from '../../types';
import { JorbHeader } from '../../components/JorbHeader';
import { useInboxStatus } from '../../hooks/useInboxStatus';
import { useNavState } from '../../hooks/useNavState';

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
 *   inbox_tab         -> bar height 84; JorbHeader row only (no buttons,
 *                        no nav strip), three-way speech derive (reading >
 *                        cross-actor paused > idle)
 *   queued            -> bar height 112; JorbHeader + nav strip, no buttons
 *   running           -> bar height 112; JorbHeader + nav strip + Stop
 *   needs_review      -> bar height 112; JorbHeader + nav strip + Stop (tailor ready)
 *   paused_for_user   -> bar height 112; JorbHeader + nav strip + Stop + Continue
 *   completed/failed -> bar height 112; JorbHeader + nav strip, no buttons
 *   stopped          -> bar height 0; bar hidden, viewA handed back to the
 *                       user full-bleed + interactive. Stop = "I'll take over."
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

// The bar is two stacked rows for agent sessions: the JorbHeader row (84,
// trimmed from the old 96) + the browser-chrome nav strip (28) = 112 total.
// Inbox tabs render the header row only (84, no strip - observation-only).
const BAR_HEADER_HEIGHT = 84;
const NAV_STRIP_HEIGHT = 28;
const INBOX_TAB_PREFIX = '__inbox_';

const INBOX_TAB_SPEECH_READING =
  "Reading your inbox right now for a verification code...";
const INBOX_TAB_SPEECH_CROSS_ACTOR_PAUSED =
  "Find the verification code in your inbox, then return to your apply tab to type it in and hit Continue.";
const INBOX_TAB_SPEECH_IDLE =
  "I'll check your inbox for verification codes when you apply.";

/**
 * paused_for_user reason -> tab-agnostic speech variant (C13): the six
 * EmailAgent give_up reasons (OTP handover) + password_required
 * (request_user_login - the user types their password themselves).
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
  password_required:
    "This portal wants you to sign in - and I never handle passwords. Sign in or create your account on your apply form, then hit Continue and I'll take it from there.",
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
      // Never-submit is a permanent product rule - the agent fills, the user submits.
      return "All done - your application is filled and ready for your review. Submit is yours.";
    case 'failed':
      // One fixed line - bar speech is a hardcoded English vocabulary, no
      // free text. The specific reason stays in error_message (DB record).
      // The refund claim is always true for a failed row: every
      // failed-status path refunds (C15).
      return "I ran into an error and couldn't finish this application. Your credits for this run have been refunded.";
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
    // OTP reasons only: a password pause (password_required) is resolved on
    // the apply tab, not the inbox - "find the verification code" speech
    // here would mislead.
    if (paused && paused.reason && OTP_PAUSED_REASONS.has(paused.reason)) {
      return INBOX_TAB_SPEECH_CROSS_ACTOR_PAUSED;
    }
  }
  return INBOX_TAB_SPEECH_IDLE;
  // Note: we deliberately do NOT scope the cross-actor branch to "this
  // specific inbox is the one the EmailAgent was using" - any OTP-handover
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

  // Stop is async: the press travels IPC -> WS -> server, the apply loop and
  // the cross-process document tailor observe it a beat later, then the job
  // flips to `stopped` and this bar hides. Until then the button holds a
  // "Stopping..." state so the press registers visibly instead of feeling dead.
  // Reset when the active job changes - a fresh run must start un-stopping.
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    setStopping(false);
  }, [activeJob?.id]);

  // Bar height: hidden/stopped -> 0; inbox tab -> header only (84); agent
  // session -> header + nav strip (112). Renderer pushes this to main so
  // BrowserView bounds re-flow under the bar.
  const isAgentMode = mode !== 'hidden' && mode !== 'stopped' && mode !== 'inbox_tab';
  useEffect(() => {
    const h =
      mode === 'hidden' || mode === 'stopped'
        ? 0
        : mode === 'inbox_tab'
          ? BAR_HEADER_HEIGHT
          : BAR_HEADER_HEIGHT + NAV_STRIP_HEIGHT;
    // Dev observability: the bar's own decision (what it derived, what height it
    // asked main to reserve). Pair with main's `[Windows] action-bar height` to
    // tell a missing-bar bug apart: no request here -> binding/derive issue;
    // request here but no reserve there -> bounds re-flow issue.
    window.Finbro.debug('bar', `mode=${mode} -> setBarHeight(${h})`);
    window.Finbro.panel.setBarHeight(h);
  }, [mode]);

  // Browser-chrome strip state: viewA's URL + history availability for the
  // active agent session. Null until the first pull/push lands.
  const navState = useNavState(isAgentMode && activeJob ? activeJob.id : null);

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

  // `stopped` hides the bar (height 0) so the user gets a full-bleed,
  // interactive browser back after pressing Stop: viewA persists (no
  // destroySession on stop) and CDP never blocked input, so the only thing
  // standing between the user and the page was this chrome. Stop = take over.
  if (mode === 'hidden' || mode === 'stopped') return null;

  // Inbox tabs have no buttons (observation-only) - the apply session
  // that's paused is stopped from its own tab. No nav strip either.
  if (mode === 'inbox_tab') {
    return (
      <div className="action-bar action-bar--inbox-tab">
        <div className="action-bar__main">
          <JorbHeader speech={speech} />
        </div>
      </div>
    );
  }

  // Stop is offered only while the agent is mid-run, waiting on the
  // user, or paused-for-user. Terminal and not-yet-started jobs have
  // nothing to stop.
  const canStop =
    mode === 'running' || mode === 'needs_review' || mode === 'paused_for_user';
  const canContinue = mode === 'paused_for_user';

  // Continue renders to the LEFT of Stop (16px gap via its margin-right):
  // it's the "your turn" button and must be seen first; the green-gleam vs
  // red-glass asymmetry keeps the two unmistakable.
  const trailing = (canStop || canContinue) ? (
    <>
      {canContinue && (
        <button
          className="action-bar__continue"
          onClick={() => onContinue(activeJob!.id)}
        >
          Continue
        </button>
      )}
      {canStop && (
        <button
          className="action-bar__stop"
          onClick={() => { setStopping(true); onStop(activeJob!.id); }}
          disabled={stopping}
          aria-busy={stopping}
        >
          {stopping ? (
            <>
              <span className="action-bar__stop-spinner" aria-hidden="true" />
              Stopping…
            </>
          ) : (
            'Stop Agent'
          )}
        </button>
      )}
    </>
  ) : undefined;

  const barClassName = `action-bar ${mode === 'paused_for_user' ? 'action-bar--paused' : ''}`.trim();

  // Browser parity, read-only URL: protocol stripped for display, full
  // path kept. The arrows are LIVE - the user can already interact with
  // viewA mid-run (CDP never blocks input), so history is the same class.
  const displayUrl = (navState?.url || '').replace(/^https?:\/\//, '');

  return (
    <div className={barClassName}>
      <div className="action-bar__main">
        <JorbHeader speech={speech} trailing={trailing} />
      </div>
      <div className="action-bar__nav">
        <button
          className="action-bar__nav-btn"
          disabled={!navState?.canGoBack}
          onClick={() => activeJob && window.Finbro.session.historyGo(activeJob.id, -1)}
          aria-label="Back"
          title="Back"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          className="action-bar__nav-btn"
          disabled={!navState?.canGoForward}
          onClick={() => activeJob && window.Finbro.session.historyGo(activeJob.id, 1)}
          aria-label="Forward"
          title="Forward"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <div className="action-bar__nav-url" title={navState?.url || ''}>
          {displayUrl}
        </div>
      </div>
    </div>
  );
};
