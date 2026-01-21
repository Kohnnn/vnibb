/**
 * Login Page
 * 
 * Provides email/password login, Google OAuth, and magic link options.
 */

"use client";

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get('redirectTo') || '/dashboard';

    const {
        signIn,
        signInWithGoogle,
        signInWithMagicLink,
        signInAsAdmin,
        signInAsGuest,
        canAdminLogin,
        canGuestLogin
    } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [magicLinkSent, setMagicLinkSent] = useState(false);
    const [useMagicLink, setUseMagicLink] = useState(false);

    const handleEmailLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error } = await signIn(email, password);

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            router.push(redirectTo);
        }
    };

    const handleMagicLink = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error } = await signInWithMagicLink(email);

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            setMagicLinkSent(true);
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError(null);

        const { error } = await signInWithGoogle();

        if (error) {
            setError(error.message);
            setLoading(false);
        }
    };

    const handleAdminLogin = () => {
        signInAsAdmin();
        router.push(redirectTo);
    };

    const handleGuestLogin = () => {
        signInAsGuest();
        router.push(redirectTo);
    };

    return (
        <div className="max-w-md w-full space-y-8 p-8 bg-zinc-900 rounded-lg border border-zinc-800">
            <div>
                <h2 className="text-3xl font-bold text-center text-white">
                    Sign in to VNIBB
                </h2>
                <p className="mt-2 text-center text-sm text-zinc-400">
                    Vietnam stock market analytics dashboard
                </p>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-3 rounded">
                    {error}
                </div>
            )}

            {magicLinkSent && (
                <div className="bg-green-500/10 border border-green-500/50 text-green-500 px-4 py-3 rounded">
                    Check your email for the magic link!
                </div>
            )}

            {/* Primary: Google Sign-In */}
            <div>
                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-zinc-600 rounded-md shadow-sm text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                    </svg>
                    Sign in with Google
                </button>
            </div>

            {/* Guest Login */}
            {canGuestLogin && (
                <div>
                    <button
                        onClick={handleGuestLogin}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        Continue as Guest (View-only)
                    </button>
                </div>
            )}

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-zinc-700"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-zinc-900 text-zinc-500">or sign in with email</span>
                </div>
            </div>

            <form onSubmit={useMagicLink ? handleMagicLink : handleEmailLogin} className="space-y-4">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
                        Email address
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="you@example.com"
                    />
                </div>

                {!useMagicLink && (
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 block w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="••••••••"
                        />
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => setUseMagicLink(!useMagicLink)}
                        className="text-sm text-blue-400 hover:text-blue-300"
                    >
                        {useMagicLink ? 'Use password instead' : 'Use magic link'}
                    </button>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'Loading...' : useMagicLink ? 'Send magic link' : 'Sign in'}
                </button>
            </form>

            <p className="text-center text-sm text-zinc-400">
                Don't have an account?{' '}
                <Link href="/signup" className="font-medium text-blue-400 hover:text-blue-300">
                    Sign up
                </Link>
            </p>

            {/* Admin Login - Development Only */}
            {canAdminLogin && (
                <div className="pt-4 border-t border-zinc-800">
                    <button
                        onClick={handleAdminLogin}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 text-xs font-medium text-orange-400/60 hover:text-orange-400 border border-dashed border-orange-500/30 rounded transition-colors"
                    >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Dev: Sign in as Admin
                    </button>
                </div>
            )}
        </div>
    );
}

function LoginLoading() {
    return (
        <div className="max-w-md w-full space-y-8 p-8 bg-zinc-900 rounded-lg border border-zinc-800">
            <div className="animate-pulse">
                <div className="h-8 bg-zinc-800 rounded w-3/4 mx-auto mb-4"></div>
                <div className="h-4 bg-zinc-800 rounded w-1/2 mx-auto"></div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-black">
            <Suspense fallback={<LoginLoading />}>
                <LoginForm />
            </Suspense>
        </div>
    );
}
