import { contextBridge } from 'electron';

// Electron detection flag — available before any page JS runs.
// This must be in the preload (not did-finish-load injection) so the web app's
// onAuthStateChange handler can see it during initial hydration.
contextBridge.exposeInMainWorld('__FINBRO_ENV__', { isElectron: true });
