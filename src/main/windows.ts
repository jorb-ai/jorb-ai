import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import log from './logger';
import { getConfig } from './config';
import { init as initPanels, layoutBrowserViews, destroyAll as destroyAllPanels, navigateSession } from './panels';
import { setMainWindowRef } from './auth';

let mainWindow: BrowserWindow | null = null;

// Sidebar zone is 190px: a 180px floating glass card with a tight gutter
// (6px L/T/B + 4px R). The middle panel butts against the card's right
// edge with just enough breathing room for the card's drop shadow.
// Action bar is binary: 0 when no agent session is active (idle /
// system tab), or 96 for any agent-session state (the JorbHeader).
// Renderer pushes height changes via `panel:set-bar-height` so
// BrowserView bounds re-flow. Must stay in sync with
// `--sidebar-zone-width` in renderer/styles.css.
const SIDEBAR_ZONE_WIDTH = 190;
const DEFAULT_BAR_HEIGHT = 0;

let currentBarHeight = DEFAULT_BAR_HEIGHT;

export async function createMainWindow(): Promise<BrowserWindow> {
  log.info('[Windows] Creating main window...');

  const config = getConfig();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(width, 1400),
    height: Math.min(height, 900),
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'Jorb AI',
    backgroundColor: '#FDFDFB',
    show: false,
  });

  setMainWindowRef(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Dev: load from Vite's dev server (HMR for renderer code + CSS).
  // Prod: load the built file. The env var is set by `npm run dev`.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    log.info(`[Windows] Loading renderer from Vite dev server: ${devUrl}`);
    await mainWindow.loadURL(devUrl);
  } else {
    const rendererPath = path.join(__dirname, '../renderer/index.html');
    await mainWindow.loadFile(rendererPath);
  }

  const [cw, ch] = mainWindow.getContentSize();
  initPanels(mainWindow, computeBrowserViewBounds(cw, ch));

  // Load webapp as the default __webapp__ session so the middle panel is
  // not blank while the user authenticates.
  navigateSession('__webapp__', 'http://localhost:3000').catch(() => {
    log.warn('[Windows] localhost:3000 not available — BrowserView blank');
  });

  mainWindow.on('resize', () => {
    if (!mainWindow) return;
    const [w, h] = mainWindow.getContentSize();
    layoutBrowserViews(computeBrowserViewBounds(w, h));
  });

  mainWindow.on('closed', () => {
    destroyAllPanels();
    mainWindow = null;
  });

  if (config.debugMode) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  log.info('[Windows] Main window created');
  return mainWindow;
}

function computeBrowserViewBounds(windowWidth: number, windowHeight: number) {
  return {
    x: SIDEBAR_ZONE_WIDTH,
    y: currentBarHeight,
    width: windowWidth - SIDEBAR_ZONE_WIDTH,
    height: windowHeight - currentBarHeight,
  };
}

/**
 * Called by ipc when the renderer's action bar changes height:
 *   0  = hidden (idle / system tab)
 *   96 = the JorbHeader (any agent-session state)
 * We store the new value and re-flow all BrowserViews so the browser
 * area lines up flush with whatever chrome the renderer is drawing.
 */
export function setActionBarHeight(height: number): void {
  if (height === currentBarHeight) return;
  currentBarHeight = height;
  if (!mainWindow) return;
  const [w, h] = mainWindow.getContentSize();
  layoutBrowserViews(computeBrowserViewBounds(w, h));
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
