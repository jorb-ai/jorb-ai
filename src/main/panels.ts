import { BrowserView, BrowserWindow, session as electronSession } from 'electron';
import * as path from 'path';
import { getConfigValue } from './config';

let portalSession: Electron.Session | null = null;

function getPortalSession(): Electron.Session {
  if (!portalSession) {
    portalSession = electronSession.fromPartition('persist:portal');
  }
  return portalSession;
}

let browserView: BrowserView | null = null;
let parentWindow: BrowserWindow | null = null;

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createBrowserView(
  window: BrowserWindow,
  bounds: PanelBounds,
): BrowserView {
  parentWindow = window;

  browserView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload-webview.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: getPortalSession(),
    },
  });

  window.addBrowserView(browserView);
  browserView.setBounds(bounds);
  browserView.setAutoResize({ width: true, height: true });

  // Inject Electron detection flag on every page load
  browserView.webContents.on('did-finish-load', () => {
    browserView!.webContents.executeJavaScript(`
      window.__FINBRO_ENV__ = { isElectron: true };
    `).catch(() => {});
  });

  if (getConfigValue('debugMode')) {
    browserView.webContents.on('did-navigate', (_event, url) => {
      console.log('[Panels] BrowserView navigated to:', url);
    });
  }

  return browserView;
}

export async function navigateTo(url: string): Promise<number> {
  if (!browserView) {
    throw new Error('BrowserView not created');
  }
  await browserView.webContents.loadURL(url);

  // Attach debugger if not already attached (needed for CDP)
  if (!browserView.webContents.debugger.isAttached()) {
    try {
      browserView.webContents.debugger.attach('1.3');
      console.log('[Panels] Debugger attached');
    } catch (err) {
      console.error('[Panels] Failed to attach debugger:', err);
    }
  }

  return browserView.webContents.id;
}

export function getBrowserView(): BrowserView | null {
  return browserView;
}

export function getCurrentUrl(): string {
  return browserView ? browserView.webContents.getURL() : '';
}

export function layoutBrowserView(bounds: PanelBounds): void {
  if (browserView) {
    browserView.setBounds(bounds);
  }
}

export function destroy(): void {
  if (browserView && parentWindow) {
    parentWindow.removeBrowserView(browserView);
    (browserView.webContents as any).destroy();
    browserView = null;
  }
  parentWindow = null;
}
