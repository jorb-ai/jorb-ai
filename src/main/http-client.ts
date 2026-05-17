import log from './logger';
import { getConfigValue } from './config';
import { getCurrentToken } from './auth';

// `automationServerUrl` is the WS endpoint (e.g. `ws://127.0.0.1:8000/browser/ws`).
// HTTP requests hit the same host: strip the WS path and swap `ws→http` /
// `wss→https`. One config value, two protocols — beats a parallel base-URL
// setting we'd have to remember to update twice.
function deriveHttpBase(): string {
  const wsUrl = getConfigValue('automationServerUrl');
  return wsUrl.replace(/^ws/, 'http').replace(/\/browser\/ws$/, '');
}

export async function closeBrowserJob(jobId: string): Promise<void> {
  const token = getCurrentToken();
  if (!token) {
    log.warn(`[Http] closeBrowserJob ${jobId.slice(0, 8)} — no token, skipping`);
    return;
  }
  const url = `${deriveHttpBase()}/browser/jobs/${jobId}/close`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log.warn(`[Http] closeBrowserJob ${jobId.slice(0, 8)} — ${res.status} ${res.statusText}`);
      return;
    }
    log.info(`[Http] closeBrowserJob ${jobId.slice(0, 8)} — ok`);
  } catch (err) {
    log.error(`[Http] closeBrowserJob ${jobId.slice(0, 8)} — error:`, err);
  }
}
