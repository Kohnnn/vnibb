/**
 * Supabase Client Configuration
 * 
 * Creates a browser-side Supabase client for authentication.
 * Handles missing environment variables gracefully for build time.
 */

import { createBrowserClient } from '@supabase/ssr';

// Placeholder values for build time when env vars are not available
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Flag to check if Supabase is properly configured
export const isSupabaseConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const createClient = () => {
    return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
};

// Only create the client if we're in a browser environment
export const supabase = typeof window !== 'undefined' ? createClient() : null;
