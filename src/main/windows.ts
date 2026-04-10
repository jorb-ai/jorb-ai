import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import log from './logger';
import { getConfig } from './config';
import { init as initPanels, layoutBrowserViews, destroyAll as destroyAllPanels, navigateSession } from './panels';
import { setMainWindowRef } from './auth';

let mainWindow: BrowserWindow | null = null;

const LEFT_PANEL_WIDTH = 180;
const ACTION_BAR_HEIGHT = 34;
let rightPanelWidth = 260;

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
    backgroundColor: '#ffffff',
    show: false,
  });

  setMainWindowRef(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(rendererPath);

  // Initialize lifecycle manager and load web app as the default session
  const contentSize = mainWindow.getContentSize();
  initPanels(mainWindow, computeBrowserViewBounds(contentSize[0], contentSize[1]));

  // Load web app immediately so user can browse and trigger auto-apply
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
  // +4 accounts for the resize handle width
  return {
    x: LEFT_PANEL_WIDTH,
    y: ACTION_BAR_HEIGHT,
    width: windowWidth - LEFT_PANEL_WIDTH - rightPanelWidth - 4,
    height: windowHeight - ACTION_BAR_HEIGHT,
  };
}

export function setRightPanelWidth(width: number): void {
  rightPanelWidth = width;
  if (mainWindow) {
    const [w, h] = mainWindow.getContentSize();
    layoutBrowserViews(computeBrowserViewBounds(w, h));
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
