/**
 * OAuth Callback Handler
 * 
 * Handles OAuth/magic-link redirects from active auth provider.
 */

"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function AuthCallbackPage() {
    const router = useRouter();

    useEffect(() => {
        const handleCallback = async () => {
            if (!supabase || !isSupabaseConfigured) {
                console.error('Supabase is not configured');
                router.push('/login?error=supabase_not_configured');
                return;
            }

            const { error } = await supabase.auth.getSession();

            if (error) {
                console.error('Error during auth callback:', error);
                router.push('/login?error=callback_failed');
            } else {
                router.push('/dashboard');
            }
        };

        handleCallback();
    }, [router]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
            <div className="text-center" role="status" aria-live="polite">
                <div className="inline-block h-12 w-12 animate-spin rounded-full border-2 border-[var(--border-color)] border-t-[var(--accent-blue)]" />
                <p className="mt-4 text-sm text-[var(--text-secondary)]">Completing sign in…</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">If this does not finish, return to sign in and try again.</p>
            </div>
        </div>
    );
}
