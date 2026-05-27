// Domains whose cookies the cookie-import grafts into the agent's BrowserView
// partitions. Scoped on purpose: we never graft the user's full cookie jar —
// only the surfaces a job application actually touches. The import filters
// every CDP cookie against this list before writing it into our partition.
//
// Mirrors the server-side ATS sender allowlist
// (web-api/finbroapi/src/finbroagents/browseragent/inbox_sender_allowlist.py)
// plus the identity providers a portal sign-in / OTP flow leans on. Widen here
// as the test surface grows; this is the single source of truth on the desktop
// side. New domains are a code change, never user/LLM-authored.

export const COOKIE_IMPORT_ALLOWLIST: readonly string[] = [
  // ATS / job-board platforms
  'greenhouse.io',
  'lever.co',
  'myworkdayjobs.com',
  'workday.com',
  'workable.com',
  'smartrecruiters.com',
  'icims.com',
  'bamboohr.com',
  'ashbyhq.com',
  'recruitee.com',
  'jobvite.com',
  'rippling.com',
  'personio.com',
  // identity providers a portal sign-in / OTP flow leans on
  'google.com',
  'gmail.com',
  'linkedin.com',
  'microsoftonline.com',
];

// Spoof-safe exact-or-subdomain match — the inbox-access spec rule, NOT a naive
// `endsWith` (which would accept `evilgreenhouse.io` for `greenhouse.io`).
// `domain` is a cookie host already leading-dot-stripped by
// `normalizedCookieDomain` in cookies.ts.
export function isAllowlistedCookieDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return COOKIE_IMPORT_ALLOWLIST.some(
    (allowed) => d === allowed || d.endsWith('.' + allowed),
  );
}
