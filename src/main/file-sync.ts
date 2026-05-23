import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import WebSocket from 'ws';
import log from './logger';

// WebSocket reference for sending acks
let ws: WebSocket | null = null;

// Paths. files/ is a pure write-once cache: wiped on every cold start,
// populated only by file_sync_trigger, consumed by the next CDP
// upload_file, then forgotten. The desktop holds no truth across launches.
const USER_DATA_PATH = app.getPath('userData');
const FILES_DIR = path.join(USER_DATA_PATH, 'files');

/**
 * Set WebSocket reference for sending acks.
 */
export function setWebSocket(websocket: WebSocket): void {
  ws = websocket;
  log.info('[FileSync] WebSocket reference set');
}

/**
 * Initialize file-sync system on app startup. Wipes files/ so the
 * directory is always empty between launches.
 */
export async function initFileSync(): Promise<void> {
  log.info('[FileSync] Initializing — wiping files/, starting fresh');
  log.debug('[FileSync] Files directory:', FILES_DIR);

  try {
    if (fs.existsSync(FILES_DIR)) {
      fs.rmSync(FILES_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(FILES_DIR, { recursive: true });
    log.info('[FileSync] Initialization complete');
  } catch (error) {
    log.error('[FileSync] Initialization failed:', error);
  }
}

/**
 * Send a file_sync_ack for a specific file_id. Unblocks tailor.py's
 * generate_and_sync_pdf wait_for. Safe to call any time; the server
 * silently ignores acks with no pending event.
 */
function sendFileSyncAck(fileId: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'file_sync_ack', file_id: fileId }));
    } catch (err) {
      log.warn('[FileSync] Failed to send file_sync_ack:', err);
    }
  }
}

/**
 * Handle a file_sync_trigger from the server. The payload carries the
 * signed URL inline so this is a single round trip — no metadata
 * listing, no separate request_signed_urls follow-up.
 */
export async function handleSyncTrigger(payload: {
  file_id: string;
  file_name: string;
  signed_url: string;
}): Promise<void> {
  const { file_id, file_name, signed_url } = payload;
  log.info('[FileSync] Trigger — downloading:', file_name, `(${file_id})`);

  try {
    await downloadFile(file_id, file_name, signed_url);
    sendFileSyncAck(file_id);
    log.info('[FileSync] Trigger — downloaded + acked:', file_name);
  } catch (error) {
    log.error('[FileSync] Trigger — download failed for', file_name, ':', error);
    // Do NOT ack on failure — let tailor.py time out and surface
    // "File sync timeout" rather than return a path to a missing
    // file that upload_file would silently fail on.
  }
}

/**
 * Resolve relative file path to absolute path.
 * @param relativePath - Relative path from files directory (e.g. "abc-123/resume.pdf")
 * @returns Absolute path or null if file doesn't exist
 */
export function resolveFilePath(relativePath: string): string | null {
  try {
    const fullPath = path.join(FILES_DIR, relativePath);
    if (fs.existsSync(fullPath)) return fullPath;
    log.warn('[FileSync] File not found:', fullPath);
    return null;
  } catch (error) {
    log.error('[FileSync] Error resolving file path:', error);
    return null;
  }
}

/**
 * Download a file from signed URL into files/{file_id}/{file_name}.
 */
function downloadFile(id: string, fileName: string, signedUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      log.debug('[FileSync] Signed URL:', signedUrl);

      const fileDir = path.join(FILES_DIR, id);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      const filePath = path.join(fileDir, fileName);
      log.debug('[FileSync] Saving file to:', filePath);

      const fileStream = fs.createWriteStream(filePath);

      https.get(signedUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (error) => {
          try { fs.unlinkSync(filePath); } catch { /* partial file may not exist */ }
          reject(error);
        });

      }).on('error', (error) => {
        reject(error);
      });

    } catch (error) {
      reject(error);
    }
  });
}
