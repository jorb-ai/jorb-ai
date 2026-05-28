export interface AppConfig {
  debugMode: boolean;
  automationServerUrl: string;
  webAppUrl: string;
}

export const DEV_DEFAULT_CONFIG: AppConfig = {
  debugMode: true,
  automationServerUrl: 'ws://127.0.0.1:8000/browser/ws',
  webAppUrl: 'http://localhost:3000',
};

export const PROD_DEFAULT_CONFIG: AppConfig = {
  debugMode: false,
  automationServerUrl: 'wss://api.jorb.ai/browser/ws',
  webAppUrl: 'https://jorb.ai',
};

export const DEFAULT_CONFIG = DEV_DEFAULT_CONFIG;
