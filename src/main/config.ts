import Store from 'electron-store';
import { app } from 'electron';
import log from 'electron-log/main';
import { AppConfig, DEV_DEFAULT_CONFIG, PROD_DEFAULT_CONFIG } from '../types/config.types';

function runtimeDefaults(): AppConfig {
  const base = app.isPackaged ? PROD_DEFAULT_CONFIG : DEV_DEFAULT_CONFIG;
  return {
    ...base,
    automationServerUrl: process.env.JORB_AUTOMATION_SERVER_URL || base.automationServerUrl,
    webAppUrl: process.env.JORB_WEBAPP_URL || base.webAppUrl,
  };
}

// Initialize electron-store with schema validation
const store = new Store<AppConfig>({
  defaults: runtimeDefaults(),
  name: 'jorb-config'
});

/**
 * Get the current configuration
 * Merges stored config with defaults to ensure all keys exist
 */
export function getConfig(): AppConfig {
  const stored = store.store;
  return { ...runtimeDefaults(), ...stored };
}

/**
 * Update configuration (partial update)
 * @param updates - Partial configuration to merge
 */
export function setConfig(updates: Partial<AppConfig>): void {
  const current = getConfig();
  const updated = { ...current, ...updates };
  store.store = updated;
  
  log.debug('[Config] Updated:', updates);
}

/**
 * Get a specific config value
 * @param key - Configuration key
 * @returns Value or undefined
 */
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return getConfig()[key];
}

/**
 * Set a specific config value
 * @param key - Configuration key
 * @param value - Value to set
 */
export function setConfigValue<K extends keyof AppConfig>(
  key: K,
  value: AppConfig[K]
): void {
  store.set(key, value);
  
  log.debug(`[Config] Set ${String(key)}:`, value);
}

export function getConfigPath(): string {
  return store.path;
}
