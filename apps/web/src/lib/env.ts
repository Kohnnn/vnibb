// Environment variable validation and central configuration.
// Prevents silent failures due to missing required environment variables.

const isProdEnv = process.env.NODE_ENV === 'production';
const defaultApiUrl = isProdEnv ? '' : 'http://localhost:8000';
const defaultWsUrl = isProdEnv ? '' : 'ws://localhost:8000/api/v1/ws/prices';
const rawApiUrl = (process.env.NEXT_PUBLIC_API_URL || defaultApiUrl).trim();
const shouldForceHttps = isProdEnv
  && rawApiUrl.startsWith('http://')
  && !/localhost|127\.0\.0\.1/.test(rawApiUrl);
const apiUrl = shouldForceHttps ? rawApiUrl.replace(/^http:/, 'https:') : rawApiUrl;
const rawWsUrl = (process.env.NEXT_PUBLIC_WS_URL || defaultWsUrl).trim();
const shouldForceWss = isProdEnv
  && rawWsUrl.startsWith('ws://')
  && !/localhost|127\.0\.0\.1/.test(rawWsUrl);
const wsUrl = shouldForceWss ? rawWsUrl.replace(/^ws:/, 'wss:') : rawWsUrl;
const wsBaseUrl = wsUrl.replace(/\/$/, '');
const wsPriceUrl = /\/ws\/prices$/.test(wsBaseUrl)
  ? wsBaseUrl
  : /\/ws$/.test(wsBaseUrl)
    ? `${wsBaseUrl}/prices`
    : `${wsBaseUrl}/api/v1/ws/prices`;

const enableRealtimeRaw = process.env.NEXT_PUBLIC_ENABLE_REALTIME;
const enableRealtime = enableRealtimeRaw !== undefined
  ? enableRealtimeRaw === 'true'
  : true;

// Validate at module load time (client-side only)
const missing: string[] = [];
if (!process.env.NEXT_PUBLIC_API_URL) {
  missing.push('NEXT_PUBLIC_API_URL');
}
if (!process.env.NEXT_PUBLIC_WS_URL) {
  missing.push('NEXT_PUBLIC_WS_URL');
}

if (isProdEnv && missing.length > 0) {
  throw new Error(
    `Missing required production environment variables: ${missing.join(', ')}. `
    + `Set explicit Vercel values for the backend API and websocket hosts before building.`
  );
}

if (!isProdEnv && missing.length > 0 && typeof window !== 'undefined') {
  console.warn(
    `⚠️ Missing required environment variables:\n` +
    missing.map(v => `  - ${v}`).join('\n') +
    `\n\nFalling back to local defaults. Copy .env.local.example to .env.local for custom configuration.`
  );
}

export const env = {
  apiUrl,
  wsUrl: wsPriceUrl,
  wsBaseUrl,
  wsPriceUrl,
  authProvider: process.env.NEXT_PUBLIC_AUTH_PROVIDER || 'supabase',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  appwriteEndpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
  appwriteProjectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
  analyticsId: process.env.NEXT_PUBLIC_ANALYTICS_ID,
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || '',
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || '',
  isDev: process.env.NEXT_PUBLIC_ENV === 'development' || process.env.NODE_ENV === 'development',
  isProd: isProdEnv,
  enableRealtime,
} as const;

export type Env = typeof env;
