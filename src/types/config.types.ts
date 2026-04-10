export interface AppConfig {
  debugMode: boolean;
  automationServerUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  debugMode: true,
  automationServerUrl: 'ws://127.0.0.1:8000/browser/ws',
  supabaseUrl: 'https://optsvxrgzocfuyyrbkqd.supabase.co',
  supabasePublishableKey: 'sb_publishable_bJw9zTxyqsiE83gw8kV6Cw_tXyCXGLc',
};
