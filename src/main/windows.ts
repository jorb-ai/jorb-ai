import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { getConfig } from './config';
import { createBrowserView, layoutBrowserView, destroy as destroyPanels } from './panels';
import { setMainWindowRef } from './auth';

let mainWindow: BrowserWindow | null = null;

const LEFT_PANEL_WIDTH = 190;
const RIGHT_PANEL_WIDTH = 220;
const ACTION_BAR_HEIGHT = 42;

export async function createMainWindow(): Promise<BrowserWindow> {
  console.log('[Windows] Creating main window...');

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
    backgroundColor: '#f8f9fa',
    show: false,
  });

  setMainWindowRef(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(rendererPath);

  // Create BrowserView for middle panel and load web app
  const contentSize = mainWindow.getContentSize();
  const view = createBrowserView(mainWindow, computeBrowserViewBounds(contentSize[0], contentSize[1]));
  view.webContents.loadURL('http://localhost:3000').catch(() => {
    console.log('[Windows] localhost:3000 not available — BrowserView blank');
  });

  mainWindow.on('resize', () => {
    if (!mainWindow) return;
    const [w, h] = mainWindow.getContentSize();
    layoutBrowserView(computeBrowserViewBounds(w, h));
  });

  mainWindow.on('closed', () => {
    destroyPanels();
    mainWindow = null;
  });

  if (config.debugMode) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  console.log('[Windows] Main window created');
  return mainWindow;
}

function computeBrowserViewBounds(windowWidth: number, windowHeight: number) {
  return {
    x: LEFT_PANEL_WIDTH,
    y: ACTION_BAR_HEIGHT,
    width: windowWidth - LEFT_PANEL_WIDTH - RIGHT_PANEL_WIDTH,
    height: windowHeight - ACTION_BAR_HEIGHT,
  };
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
