import Store from 'electron-store';
import log from './logger';
import { AppConfig, DEFAULT_CONFIG } from '../types/config.types';

// Initialize electron-store with schema validation
const store = new Store<AppConfig>({
  defaults: DEFAULT_CONFIG,
  name: 'jorb-config'
});

/**
 * Get the current configuration
 * Merges stored config with defaults to ensure all keys exist
 */
export function getConfig(): AppConfig {
  const stored = store.store;
  return { ...DEFAULT_CONFIG, ...stored };
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
  const value = store.get(key);
  return value !== undefined ? value : DEFAULT_CONFIG[key];
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
