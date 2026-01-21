// Environment variable validation and central configuration.
// Prevents silent failures due to missing required environment variables.

const requiredVars = ['NEXT_PUBLIC_API_URL'] as const;

// Validate at module load time (client-side only)
const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0 && typeof window !== 'undefined') {
  console.warn(
    `⚠️ Missing required environment variables:\n` +
    missing.map(v => `  - ${v}`).join('\n') +
    `\n\nFalling back to default values. Copy .env.local.example to .env.local for custom configuration.`
  );
}

export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/api/v1/ws',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  geminiApiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY,
  analyticsId: process.env.NEXT_PUBLIC_ANALYTICS_ID,
  isDev: process.env.NEXT_PUBLIC_ENV === 'development' || process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
} as const;

export type Env = typeof env;
