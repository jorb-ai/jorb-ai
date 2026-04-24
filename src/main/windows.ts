import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import log from './logger';
import { getConfig } from './config';
import { init as initPanels, layoutBrowserViews, destroyAll as destroyAllPanels, navigateSession } from './panels';
import { setMainWindowRef } from './auth';

let mainWindow: BrowserWindow | null = null;

// Sidebar is fixed; action bar is variable (44px system tab / 96px running
// agent session). The renderer notifies the main process of the current
// bar height via IPC so BrowserView bounds stay correct. Must stay in
// sync with `--sidebar-width` in renderer/styles.css.
const SIDEBAR_WIDTH = 200;
const DEFAULT_BAR_HEIGHT = 44;

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
    title: 'jorb.ai',
    backgroundColor: '#FDFDFB',
    show: false,
  });

  setMainWindowRef(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(rendererPath);

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
    x: SIDEBAR_WIDTH,
    y: currentBarHeight,
    width: windowWidth - SIDEBAR_WIDTH,
    height: windowHeight - currentBarHeight,
  };
}

/**
 * Called by ipc when the renderer's action bar changes height
 * (44px collapsed / 96px expanded). We store the new value and re-flow
 * all BrowserViews against it so the browser area lines up with whatever
 * the bar is rendering.
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
