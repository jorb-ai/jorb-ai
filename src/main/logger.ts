import log from 'electron-log/main';
import { getConfigValue } from './config';

const level = getConfigValue('debugMode') ? 'debug' : 'info';
log.transports.console.level = level;
log.transports.file.level = level;

/**
 * Format a JWT for log output. Shows head + tail so tokens that share the same
 * header prefix (e.g. `eyJhbGciOiJI...` which is the base64 of `{"alg":"HS`)
 * are actually distinguishable from each other.
 */
export function tokenPrefix(token: string | null | undefined): string {
  if (!token) return 'NULL';
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

export default log;
