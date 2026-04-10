import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import WebSocket from 'ws';
import log from './logger';

// WebSocket reference for sending messages
let ws: WebSocket | null = null;

// Local file IDs tracked in metadata.txt
let localIds: Set<string> = new Set();

// Sync state
let isSyncing: boolean = false;

// Paths
const USER_DATA_PATH = app.getPath('userData');
const FILES_DIR = path.join(USER_DATA_PATH, 'files');
const METADATA_FILE = path.join(USER_DATA_PATH, 'metadata.txt');

/**
 * Set WebSocket reference for sending messages
 */
export function setWebSocket(websocket: WebSocket): void {
  ws = websocket;
  log.info('[FileSync] WebSocket reference set');
}

/**
 * Initialize file sync system on app startup
 * Creates directories and loads metadata
 */
export async function initFileSync(): Promise<void> {
  log.info('[FileSync] Initializing file sync...');
  log.debug('[FileSync] User data path:', USER_DATA_PATH);
  log.debug('[FileSync] Files directory:', FILES_DIR);
  
  try {
    // Ensure directories exist
    ensureDirectories();
    
    // Load existing metadata
    localIds = loadLocalIds();
    log.info('[FileSync] Loaded', localIds.size, 'files from metadata');

    log.info('[FileSync] Initialization complete');
  } catch (error) {
    log.error('[FileSync] Initialization failed:', error);
  }
}

/**
 * Request file sync from server
 * Called after WebSocket registration is confirmed
 */
export function requestFileSync(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log.error('[FileSync] Cannot request sync - WebSocket not connected');
    return;
  }

  log.info('[FileSync] Requesting file sync...');

  try {
    ws.send(JSON.stringify({
      type: 'file_sync_init'
    }));
    log.info('[FileSync] File sync request sent');
  } catch (error) {
    log.error('[FileSync] Failed to send sync request:', error);
  }
}

/**
 * Handle file metadata from server
 * Compares with local files and requests signed URLs for missing ones
 */
export async function handleSyncMetadata(files: Array<{id: string, file_name: string}>): Promise<void> {
  if (isSyncing) {
    log.warn('[FileSync] Sync already in progress, ignoring request');
    return;
  }

  isSyncing = true;
  log.info('[FileSync] Received metadata for', files.length, 'files');

  try {
    const serverIds = new Set(files.map(f => f.id));
    log.debug('[FileSync] Server has', serverIds.size, 'files');
    log.debug('[FileSync] Local has', localIds.size, 'files');
    
    // Find missing files (on server but not local)
    const missingIds: string[] = [];
    serverIds.forEach(id => {
      if (!localIds.has(id)) {
        missingIds.push(id);
      }
    });
    
    // Find orphaned files (local but not on server)
    const orphanedIds: string[] = [];
    localIds.forEach(id => {
      if (!serverIds.has(id)) {
        orphanedIds.push(id);
      }
    });
    
    log.debug('[FileSync] Missing:', missingIds.length, 'files');
    log.debug('[FileSync] Orphaned:', orphanedIds.length, 'files');
    
    // Delete orphaned files
    if (orphanedIds.length > 0) {
      deleteOrphanedFiles(orphanedIds);
    }
    
    // Request signed URLs for missing files
    if (missingIds.length > 0) {
      requestSignedUrls(missingIds);
    } else {
      log.info('[FileSync] All files up to date, no downloads needed');
      isSyncing = false;
    }
    
  } catch (error) {
    log.error('[FileSync] Error handling metadata:', error);
    isSyncing = false;
  }
}

/**
 * Handle signed URLs from server
 * Downloads each file to local storage
 */
export async function handleSignedUrls(files: Array<{id: string, file_name: string, signed_url: string}>): Promise<void> {
  log.info('[FileSync] Received signed URLs for', files.length, 'files');
  
  const results = {
    synced: [] as string[],
    failed: [] as string[]
  };
  
  // Download each file sequentially
  for (const file of files) {
    try {
      log.debug('[FileSync] Downloading:', file.file_name, `(${file.id})`);
      await downloadFile(file.id, file.file_name, file.signed_url);

      localIds.add(file.id);
      appendToMetadata(file.id);
      results.synced.push(file.id);

      log.debug('[FileSync] Downloaded:', file.file_name);
    } catch (error) {
      log.error('[FileSync] Failed to download', file.file_name, ':', error);
      results.failed.push(file.id);
    }
  }
  
  log.info('[FileSync] Download summary - Success:', results.synced.length, 'Failed:', results.failed.length);

  isSyncing = false;
  log.info('[FileSync] File sync complete');
}

/**
 * Get files directory path (utility)
 */
export function getFilesDirectory(): string {
  return FILES_DIR;
}

/**
 * Resolve relative file path to absolute path
 * @param relativePath - Relative path from files directory (e.g. "abc-123/resume.pdf")
 * @returns Absolute path or null if file doesn't exist
 */
export function resolveFilePath(relativePath: string): string | null {
  try {
    const fullPath = path.join(FILES_DIR, relativePath);
    
    // Verify file exists
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    
    log.warn('[FileSync] File not found:', fullPath);
    return null;
  } catch (error) {
    log.error('[FileSync] Error resolving file path:', error);
    return null;
  }
}

/**
 * Ensure directory structure exists
 */
function ensureDirectories(): void {
  // Create files directory if it doesn't exist
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    log.info('[FileSync] Created files directory:', FILES_DIR);
  }

  if (!fs.existsSync(METADATA_FILE)) {
    fs.writeFileSync(METADATA_FILE, '', 'utf-8');
    log.info('[FileSync] Created metadata file:', METADATA_FILE);
  }
}

/**
 * Load file IDs from metadata.txt
 */
function loadLocalIds(): Set<string> {
  try {
    const content = fs.readFileSync(METADATA_FILE, 'utf-8');
    const ids = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    return new Set(ids);
  } catch (error) {
    log.error('[FileSync] Error loading metadata:', error);
    return new Set();
  }
}

/**
 * Append file ID to metadata.txt
 */
function appendToMetadata(id: string): void {
  try {
    fs.appendFileSync(METADATA_FILE, id + '\n', 'utf-8');
  } catch (error) {
    log.error('[FileSync] Error appending to metadata:', error);
  }
}

/**
 * Save all IDs to metadata.txt (used after deletion)
 */
function saveMetadata(ids: Set<string>): void {
  try {
    const content = Array.from(ids).join('\n') + '\n';
    fs.writeFileSync(METADATA_FILE, content, 'utf-8');
  } catch (error) {
    log.error('[FileSync] Error saving metadata:', error);
  }
}

/**
 * Delete orphaned files (local but not on server)
 */
function deleteOrphanedFiles(orphanedIds: string[]): void {
  log.info('[FileSync] Deleting', orphanedIds.length, 'orphaned files...');
  
  for (const id of orphanedIds) {
    try {
      const filePath = path.join(FILES_DIR, id);
      
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
        log.debug('[FileSync] Deleted:', id);
      }
      
      // Remove from local IDs
      localIds.delete(id);
      
    } catch (error) {
      log.error('[FileSync] Failed to delete', id, ':', error);
    }
  }
  
  // Save updated metadata
  saveMetadata(localIds);
  log.info('[FileSync] Orphaned files deleted');
}

/**
 * Request signed URLs from server
 */
function requestSignedUrls(fileIds: string[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log.error('[FileSync] Cannot request URLs - WebSocket not connected');
    isSyncing = false;
    return;
  }

  log.debug('[FileSync] Requesting signed URLs for', fileIds.length, 'files...');

  try {
    ws.send(JSON.stringify({
      type: 'request_signed_urls',
      file_ids: fileIds
    }));
    log.debug('[FileSync] Signed URL request sent');
  } catch (error) {
    log.error('[FileSync] Failed to request signed URLs:', error);
    isSyncing = false;
  }
}

/**
 * Download a file from signed URL
 */
function downloadFile(id: string, fileName: string, signedUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      log.debug('[FileSync] Signed URL:', signedUrl);
      
      // Create directory for this file
      const fileDir = path.join(FILES_DIR, id);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }
      
      const filePath = path.join(fileDir, fileName);
      log.debug('[FileSync] Saving file to:', filePath);
      
      const fileStream = fs.createWriteStream(filePath);
      
      // Download via HTTPS
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
          try {
            fs.unlinkSync(filePath); // Delete partial file
          } catch (unlinkError) {
            // File might not exist yet, ignore
          }
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

