// Environment variable validation and central configuration.
// Prevents silent failures due to missing required environment variables.

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const isProdEnv = process.env.NODE_ENV === 'production';
const shouldForceHttps = isProdEnv
  && rawApiUrl.startsWith('http://')
  && !/localhost|127\.0\.0\.1/.test(rawApiUrl);
const apiUrl = shouldForceHttps ? rawApiUrl.replace(/^http:/, 'https:') : rawApiUrl;
const derivedWsUrl = apiUrl.replace(/^http/, 'ws');
const rawWsUrl = process.env.NEXT_PUBLIC_WS_URL || derivedWsUrl;
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

if (missing.length > 0 && typeof window !== 'undefined') {
  console.warn(
    `⚠️ Missing required environment variables:\n` +
    missing.map(v => `  - ${v}`).join('\n') +
    `\n\nFalling back to default values. Copy .env.local.example to .env.local for custom configuration.`
  );
}

export const env = {
  apiUrl,
  wsUrl: wsPriceUrl,
  wsBaseUrl,
  wsPriceUrl,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  geminiApiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY,
  analyticsId: process.env.NEXT_PUBLIC_ANALYTICS_ID,
  isDev: process.env.NEXT_PUBLIC_ENV === 'development' || process.env.NODE_ENV === 'development',
  isProd: isProdEnv,
  enableRealtime,
} as const;

export type Env = typeof env;
