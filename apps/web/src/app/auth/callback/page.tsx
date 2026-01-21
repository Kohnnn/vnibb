/**
 * OAuth Callback Handler
 * 
 * Handles OAuth redirects from Supabase.
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
        <div className="min-h-screen flex items-center justify-center bg-black">
            <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                <p className="mt-4 text-zinc-400">Completing sign in...</p>
            </div>
        </div>
    );
}
