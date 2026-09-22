import { env } from './env';

/**
 * Application configuration object.
 * Access environment variables through this object for type safety.
 */
export const config = {
  // API
  apiUrl: env.apiUrl,
  wsUrl: env.wsPriceUrl,
  wsBaseUrl: env.wsBaseUrl,
  wsPriceUrl: env.wsPriceUrl,
  
  // Supabase
  supabaseUrl: env.supabaseUrl || '',
  supabaseAnonKey: env.supabaseAnonKey || '',

  // Auth
  authProvider: env.authProvider,
  
  // Feature flags
  enableAiAnalysis: true,
  enableRealtime: env.enableRealtime,
  enableDashboardBackendSync: env.enableDashboardBackendSync,
  backendSyncEnabled: env.enableDashboardBackendSync,
  enableAnalytics: env.enableAnalytics,
  isDev: env.isDev,
  isProd: env.isProd,
  
  // Computed
  get isSupabaseConfigured(): boolean {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey);
  },
  get apiBaseUrl(): string {
    // Ensure no trailing slash
    return this.apiUrl.replace(/\/$/, '');
  },
} as const;

export default config;
