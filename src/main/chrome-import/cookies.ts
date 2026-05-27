import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { session } from 'electron';
import WebSocket from 'ws';
import log from '../logger';
import {
  chromiumBrowserExecutableCandidates,
  findDefaultChromiumBrowser,
  resolveChromeBrowserProfile,
} from './profiles';
import { isAllowlistedCookieDomain } from './allowlist';

type Platform = NodeJS.Platform;

interface ChromeBinaryOptions {
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

const SKIP_DIRS = new Set([
  'Service Worker', 'Extensions', 'IndexedDB', 'Local Extension Settings',
  'Local Storage', 'GPUCache', 'Shared Dictionary', 'SharedCache',
]);
const SKIP_FILES = new Set([
  'SingletonLock', 'SingletonSocket', 'SingletonCookie',
  'lockfile', 'RunningChromeVersion', 'History',
]);

const CDP_STARTUP_TIMEOUT_MS = 15000;
const CDP_COOKIE_TIMEOUT_MS = 10000;

function cookieStorePaths(profilePath: string): string[] {
  return [
    path.join(profilePath, 'Cookies'),
    path.join(profilePath, 'Network', 'Cookies'),
  ];
}

function isReadableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyFileByStream(src: string, dst: string): Promise<void> {
  await pipeline(fs.createReadStream(src), fs.createWriteStream(dst));
}

function executableNames(name: string, platform: Platform): string[] {
  if (platform !== 'win32') return [name];
  const lower = name.toLowerCase();
  return lower.endsWith('.exe') ? [name] : [name, `${name}.exe`];
}

function findOnPath(names: string[], env: NodeJS.ProcessEnv, platform: Platform): string | null {
  const pathValue = platform === 'win32' ? env.Path ?? env.PATH ?? '' : env.PATH ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  const pathMod = platform === 'win32' ? path.win32 : path;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = pathMod.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function chromeBinaryCandidates(opts: ChromeBinaryOptions = {}): string[] {
  return chromiumBrowserExecutableCandidates(opts);
}

export function findChromeBinary(opts: ChromeBinaryOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const browser = findDefaultChromiumBrowser(opts);
  if (browser) return browser.path;
  for (const p of chromeBinaryCandidates(opts)) {
    if (fs.existsSync(p)) return p;
  }
  const onPath = findOnPath(
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', ...executableNames('chrome', platform)],
    env,
    platform,
  );
  if (onPath) return onPath;
  throw new Error('Compatible Chromium browser not found. Install a supported browser to import cookies.');
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') { srv.close(); reject(new Error('no port')); return; }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface CookieImportResult {
  profileId: string;
  browserName: string;
  profileDirectory: string;
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  domains: string[];
  failedDomains: string[];
  errorReasons: Record<string, number>;
  /** Cookies whose (name, domain, path) triple wasn't in the Electron jar
   *  before this sync. */
  newCookies: number;
  /** Cookies whose (name, domain, path) triple existed but value changed. */
  updatedCookies: number;
  /** Cookies whose (name, domain, path, value) matched what was already there. */
  unchangedCookies: number;
  /** Domains that had zero cookies in the Electron jar before this sync. */
  newDomains: string[];
  /** Domains that already had at least one cookie in the Electron jar. */
  updatedDomains: string[];
}

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

function cdpSameSiteToElectron(value?: string): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (value) {
    case 'Strict': return 'strict';
    case 'Lax': return 'lax';
    case 'None': return 'no_restriction';
    default: return 'unspecified';
  }
}

function normalizedCookieDomain(domain: string): string {
  return domain.startsWith('.') ? domain.substring(1) : domain;
}

function cookiePath(pathValue: string): string {
  if (!pathValue) return '/';
  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

export function electronCookieDetailsForImport(cookie: CdpCookie): Electron.CookiesSetDetails | null {
  if (!cookie.name) return null;

  const domain = normalizedCookieDomain(cookie.domain);
  if (!domain) return null;

  const pathValue = cookiePath(cookie.path);
  const scheme = cookie.secure ? 'https' : 'http';
  const details: Electron.CookiesSetDetails = {
    url: `${scheme}://${domain}${pathValue}`,
    name: cookie.name,
    value: cookie.value,
    path: pathValue,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cdpSameSiteToElectron(cookie.sameSite),
    ...(cookie.session ? {} : { expirationDate: cookie.expires }),
  };

  if (cookie.domain.startsWith('.')) {
    details.domain = cookie.domain;
  }

  return details;
}

async function copyProfileToTemp(profilePath: string, userDataDir: string): Promise<string> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chrome-profile-'));
  const destProfile = path.join(tempDir, 'Default');
  const copyFailures: Array<{ relativePath: string; code?: string; error: string }> = [];

  async function copyDir(src: string, dst: string): Promise<void> {
    await fsp.mkdir(dst, { recursive: true });
    let entries;
    try {
      entries = await fsp.readdir(src, { withFileTypes: true });
    } catch (err) {
      log.debug('chromeImport.copyProfile.readDirFailed', {
        src,
        error: (err as Error).message,
        code: (err as NodeJS.ErrnoException).code,
      });
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await copyDir(path.join(src, entry.name), path.join(dst, entry.name));
      } else {
        if (SKIP_FILES.has(entry.name)) continue;
        const sourceFile = path.join(src, entry.name);
        const destFile = path.join(dst, entry.name);
        try {
          await copyFileByStream(sourceFile, destFile);
        } catch (err) {
          const failure = {
            relativePath: path.relative(profilePath, sourceFile),
            code: (err as NodeJS.ErrnoException).code,
            error: (err as Error).message,
          };
          copyFailures.push(failure);
          if (entry.name === 'Cookies') {
            log.warn('chromeImport.copyProfile.cookieCopyFailed', {
              ...failure,
              sourceFile,
              destFile,
            });
          } else {
            log.debug('chromeImport.copyProfile.copyFileFailed', failure);
          }
        }
      }
    }
  }

  await copyDir(profilePath, destProfile);
  try {
    await copyFileByStream(path.join(userDataDir, 'Local State'), path.join(tempDir, 'Local State'));
  } catch {
    // Some profile-like directories do not have a Local State file. The
    // browser can still start with the copied profile, so keep this best-effort.
  }
  if (!cookieStorePaths(destProfile).some((cookiePath) => isReadableFile(cookiePath))) {
    log.warn('chromeImport.copyProfile.cookieStoreMissingAfterCopy', {
      profilePath,
      userDataDir,
      destProfile,
      attemptedCookieStores: cookieStorePaths(profilePath).map((cookiePath) => ({
        path: cookiePath,
        readable: isReadableFile(cookiePath),
      })),
      failedCopies: copyFailures.slice(0, 20),
      failedCopyCount: copyFailures.length,
    });
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('Could not copy the browser profile cookie store. Close the source browser and check profile file permissions, then try again.');
  }
  log.info('chromeImport.copyProfile', { src: profilePath, userDataDir, dest: tempDir });
  return tempDir;
}

async function launchChromiumHeadless(
  browserName: string,
  browserPath: string,
  tempUserDataDir: string,
  debugPort: number,
): Promise<ChildProcess> {
  log.info('chromeImport.launchChromium', { browserName, browserPath, tempUserDataDir, debugPort });

  const proc = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${tempUserDataDir}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  proc.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`${browserName} headless did not start within ${CDP_STARTUP_TIMEOUT_MS}ms.\n\nstderr: ${stderrBuf.slice(0, 500)}`));
    }, CDP_STARTUP_TIMEOUT_MS);

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes('DevTools listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`${browserName} exited with code ${code}.\n\nstderr: ${stderrBuf.slice(0, 500)}`));
    });
  });

  log.info('chromeImport.chromiumStarted', { browserName, debugPort });
  return proc;
}

async function getCookiesViaCdp(port: number): Promise<CdpCookie[]> {
  const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
  const versionInfo = (await versionRes.json()) as { webSocketDebuggerUrl: string };
  const wsUrl = versionInfo.webSocketDebuggerUrl;

  log.info('chromeImport.cdpConnect', { wsUrl });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP cookie fetch timed out'));
    }, CDP_COOKIE_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies', params: {} }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          id?: number;
          result?: { cookies: CdpCookie[] };
          error?: { message: string };
        };
        if (msg.id === 1) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
          else resolve(msg.result?.cookies ?? []);
        }
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`CDP WebSocket error: ${err.message}`));
    });
  });
}

// ── Direct decryption path (dev, macOS) ──────────────────────────────────
// Reads the "Chrome Safe Storage" keychain key + the profile's SQLite cookie
// DB and AES-decrypts in-process — no Chrome spawn. This is the DEV path: an
// unsigned dev Electron can't grant a spawned Chrome the keychain access it
// needs, so the spawn path returns 0 cookies. The trade-off is a one-time
// keychain prompt for OUR process (the dev clicks "Always Allow" once).
// Production uses the spawn path (signed app, ACL-trusted Chrome, prompt-free).

function readChromeSafeStorageKey(): string {
  // Absolute path so a minimal GUI-app PATH still resolves it. Triggers a
  // one-time macOS keychain prompt unless already "Always Allow"-ed.
  return execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Chrome Safe Storage', '-w'], { encoding: 'utf8' }).trim();
}

function sameSiteIntToCdp(v: number): CdpCookie['sameSite'] {
  // Chrome SQLite samesite: -1 unspecified, 0 None, 1 Lax, 2 Strict.
  return v === 0 ? 'None' : v === 1 ? 'Lax' : v === 2 ? 'Strict' : undefined;
}

function decryptCookieV10(encHex: string, hostKey: string, aesKey: Buffer, iv: Buffer): string | null {
  const buf = Buffer.from(encHex, 'hex');
  if (buf.length <= 3) return null;
  if (buf.subarray(0, 3).toString('latin1') !== 'v10') return null; // not v10 (e.g. v20 App-Bound) — skip
  try {
    const d = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
    d.setAutoPadding(true);
    let dec = Buffer.concat([d.update(buf.subarray(3)), d.final()]);
    // Chrome M127+ prepends SHA-256(host_key) as an integrity check. Strip it
    // when present — older cookies in the same DB may lack it, so verify by hash.
    const h = crypto.createHash('sha256').update(hostKey).digest();
    if (dec.length >= 32 && dec.subarray(0, 32).equals(h)) dec = dec.subarray(32);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

async function getCookiesViaDirectDecrypt(profilePath: string): Promise<CdpCookie[]> {
  const dbSrc = cookieStorePaths(profilePath).find((p) => isReadableFile(p));
  if (!dbSrc) throw new Error('No readable cookie store in profile.');

  // Copy the DB (+ WAL/SHM) to temp so a live, open Chrome can't lock our read.
  const tmpDb = path.join(os.tmpdir(), `jorb-ck-${process.pid}-${Date.now()}.db`);
  await fsp.copyFile(dbSrc, tmpDb);
  for (const ext of ['-wal', '-shm']) {
    try { await fsp.copyFile(dbSrc + ext, tmpDb + ext); } catch {}
  }

  let rows: Array<Record<string, string | number>>;
  try {
    const json = execFileSync('/usr/bin/sqlite3', ['-json', '-readonly', tmpDb,
      'SELECT host_key, name, hex(encrypted_value) AS enc, path, is_secure, is_httponly, expires_utc, samesite FROM cookies',
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    rows = json.trim() ? JSON.parse(json) : [];
  } finally {
    for (const ext of ['', '-wal', '-shm']) {
      await fsp.rm(tmpDb + ext, { force: true }).catch(() => {});
    }
  }

  const aesKey = crypto.pbkdf2Sync(readChromeSafeStorageKey(), 'saltysalt', 1003, 16, 'sha1');
  const iv = Buffer.alloc(16, 0x20); // 16 spaces

  const cookies: CdpCookie[] = [];
  for (const r of rows) {
    const hostKey = String(r.host_key);
    const value = decryptCookieV10(String(r.enc), hostKey, aesKey, iv);
    if (value === null) continue;
    const expiresUtc = Number(r.expires_utc);
    cookies.push({
      name: String(r.name),
      value,
      domain: hostKey,
      path: String(r.path || '/'),
      // Chrome stores expires_utc as microseconds since 1601-01-01; CDP/Electron
      // want Unix seconds. 0 = session cookie.
      expires: expiresUtc === 0 ? -1 : expiresUtc / 1_000_000 - 11_644_473_600,
      size: value.length,
      httpOnly: Number(r.is_httponly) === 1,
      secure: Number(r.is_secure) === 1,
      session: expiresUtc === 0,
      sameSite: sameSiteIntToCdp(Number(r.samesite)),
    });
  }
  log.info('chromeImport.directDecrypt', { rows: rows.length, decrypted: cookies.length });
  return cookies;
}

export async function importChromeProfileCookies(
  profileId: string,
  opts: { targetPartition?: string; method?: 'spawn' | 'decrypt' } = {},
): Promise<CookieImportResult> {
  const targetPartition = opts.targetPartition ?? 'persist:portal';
  const method = opts.method ?? 'decrypt';
  log.info('chromeImport.importCookies.start', { profileId, method, targetPartition });

  const sourceProfile = resolveChromeBrowserProfile(profileId);

  let cookies: CdpCookie[];
  if (method === 'spawn') {
    // Production path: spawn the user's own (ACL-trusted) Chrome and pull
    // already-decrypted cookies over CDP. Prompt-free, but needs a signed app —
    // an unsigned dev Electron yields 0 (keychain access denied silently).
    const tempDir = await copyProfileToTemp(sourceProfile.profilePath, sourceProfile.userDataDir);
    const debugPort = await getFreePort();
    let proc: ChildProcess | null = null;
    try {
      proc = await launchChromiumHeadless(sourceProfile.browserName, sourceProfile.browserPath, tempDir, debugPort);
      cookies = await getCookiesViaCdp(debugPort);
    } finally {
      if (proc) proc.kill();
      fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  } else {
    // Dev path: decrypt in-process (one-time keychain prompt). See above.
    cookies = await getCookiesViaDirectDecrypt(sourceProfile.profilePath);
  }

  // Scope: graft only allowlisted (job-portal + identity-provider) domains —
  // never the user's full cookie jar. See allowlist.ts.
  const fetchedTotal = cookies.length;
  cookies = cookies.filter((c) => isAllowlistedCookieDomain(normalizedCookieDomain(c.domain)));
  log.info('chromeImport.importCookies.cookiesFetched', {
    fetched: fetchedTotal,
    allowlisted: cookies.length,
    dropped: fetchedTotal - cookies.length,
    targetPartition,
  });

  // Inject into our named BrowserView partition (must match PORTAL_PARTITION in
  // panels.ts), NOT session.defaultSession — that's the dumb-terminal portal view.
  const electronSession = session.fromPartition(targetPartition);
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const importedDomains = new Set<string>();
  const failedDomainSet = new Set<string>();
  const errorReasons: Record<string, number> = {};

  // Conservative re-sync: for every domain present in the new Chrome export,
  // wipe the Electron jar's existing cookies on that domain before writing the
  // fresh set. Without this, re-syncing only updates cookies whose
  // (name, domain, path) triple still exists in Chrome — stale cookies (e.g.
  // logged-out sessions, rotated names) linger forever and the agent keeps
  // using outdated state. We only touch domains the user is actually
  // re-importing — cookies for unrelated sites (e.g. ones the agent set
  // itself during a session) are preserved.
  const targetDomains = new Set<string>();
  for (const c of cookies) {
    const d = normalizedCookieDomain(c.domain);
    if (d) targetDomains.add(d);
  }

  // Snapshot the pre-clear state so we can diff after import:
  //  - priorValueByKey[key] → previous value (for new vs updated detection)
  //  - priorCountByDomain[domain] → cookie count (for new vs updated domain)
  // Key = `${normalizedDomain}|${path}|${name}`, matching how new cookies are
  // keyed below.
  const priorValueByKey = new Map<string, string>();
  const priorCountByDomain = new Map<string, number>();
  let cleared = 0;
  for (const domain of targetDomains) {
    let existing: Electron.Cookie[];
    try {
      existing = await electronSession.cookies.get({ domain });
    } catch (err) {
      log.warn('chromeImport.preClear.getFailed', {
        domain,
        error: (err as Error).message,
      });
      continue;
    }
    for (const ec of existing) {
      const host = ec.domain?.startsWith('.') ? ec.domain.substring(1) : ec.domain;
      if (!host) continue;
      const path = ec.path ?? '/';
      const scheme = ec.secure ? 'https' : 'http';
      const url = `${scheme}://${host}${path}`;
      const key = `${host}|${path}|${ec.name}`;
      priorValueByKey.set(key, ec.value);
      priorCountByDomain.set(host, (priorCountByDomain.get(host) ?? 0) + 1);
      try {
        await electronSession.cookies.remove(url, ec.name);
        cleared++;
      } catch (err) {
        log.debug('chromeImport.preClear.removeFailed', {
          domain: ec.domain,
          name: ec.name,
          error: (err as Error).message,
        });
      }
    }
  }
  log.info('chromeImport.preClear.done', {
    targetDomains: targetDomains.size,
    cleared,
  });

  let newCookies = 0;
  let updatedCookies = 0;
  let unchangedCookies = 0;

  for (const cookie of cookies) {
    const details = electronCookieDetailsForImport(cookie);
    if (!details) {
      skipped++;
      continue;
    }

    const domain = normalizedCookieDomain(cookie.domain);

    try {
      await electronSession.cookies.set(details);
      imported++;
      importedDomains.add(domain);

      // Diff against the pre-clear snapshot so the UI can show
      // "X new / Y updated" instead of just a flat imported count.
      const key = `${domain}|${cookie.path}|${cookie.name}`;
      const prior = priorValueByKey.get(key);
      if (prior === undefined) {
        newCookies++;
      } else if (prior !== cookie.value) {
        updatedCookies++;
      } else {
        unchangedCookies++;
      }
    } catch (err) {
      failed++;
      failedDomainSet.add(domain);
      const reason = (err as Error).message || 'Unknown error';
      errorReasons[reason] = (errorReasons[reason] || 0) + 1;
      if (failed <= 20) {
        log.info('chromeImport.cookieFail', {
          name: cookie.name,
          domain: cookie.domain,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
          error: reason,
        });
      }
    }
  }

  const domains = Array.from(importedDomains);
  const failedDomains = Array.from(failedDomainSet).filter((d) => !importedDomains.has(d));

  // A domain is "new" if the Electron jar held zero cookies for it pre-clear,
  // and "updated" if it held at least one. Failed-only domains aren't counted
  // either way since nothing landed for them.
  const newDomains: string[] = [];
  const updatedDomains: string[] = [];
  for (const d of domains) {
    if ((priorCountByDomain.get(d) ?? 0) > 0) updatedDomains.push(d);
    else newDomains.push(d);
  }

  const result: CookieImportResult = {
    profileId: sourceProfile.id,
    browserName: sourceProfile.browserName,
    profileDirectory: sourceProfile.directory,
    total: cookies.length,
    imported,
    failed,
    skipped,
    domains,
    failedDomains,
    errorReasons,
    newCookies,
    updatedCookies,
    unchangedCookies,
    newDomains,
    updatedDomains,
  };

  log.info('chromeImport.importCookies.done', {
    total: result.total,
    imported: result.imported,
    failed: result.failed,
    skipped: result.skipped,
    newCookies,
    updatedCookies,
    unchangedCookies,
    newDomainCount: newDomains.length,
    updatedDomainCount: updatedDomains.length,
  });
  return result;
}

export interface SessionCookie {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Unix seconds, or null for session cookies */
  expires: number | null;
  sameSite: string;
}

/** List every cookie in the app's default Electron session jar. Used by the
 *  Settings + Onboarding cookie viewer so the user can see (and search) what
 *  was actually imported. Read-only — values are not returned. */
export async function listSessionCookies(): Promise<SessionCookie[]> {
  const electronSession = session.defaultSession;
  const all = await electronSession.cookies.get({});
  return all.map((c) => ({
    name: c.name,
    domain: c.domain ?? '',
    path: c.path ?? '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    expires: typeof c.expirationDate === 'number' ? c.expirationDate : null,
    sameSite: c.sameSite ?? 'unspecified',
  }));
}
