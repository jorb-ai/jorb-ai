export interface AppConfig {
  debugMode: boolean;
  automationServerUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  debugMode: true,
  automationServerUrl: 'ws://127.0.0.1:8000/browser/ws',
};
