/**
 * Signup Page
 * 
 * User registration with email/password.
 */

"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import Link from 'next/link';
import { VNIBB_BRAND_DESCRIPTOR, VNIBB_BRAND_NAME, VniBBLogo } from '@/components/brand/VniBBLogo';

export default function SignupPage() {
    const router = useRouter();
    const { signUp, signInWithGoogle } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (password !== confirmPassword) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupFailed, {
                method: 'email',
                error_type: 'password_mismatch',
            });
            setError("Passwords don't match");
            setLoading(false);
            return;
        }

        if (password.length < 6) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupFailed, {
                method: 'email',
                error_type: 'password_too_short',
            });
            setError("Password must be at least 6 characters");
            setLoading(false);
            return;
        }

        captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupStarted, {
            method: 'email',
        });

        const { error } = await signUp(email, password);

        if (error) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupFailed, {
                method: 'email',
                error_type: error.message,
            });
            setError(error.message);
            setLoading(false);
        } else {
            captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupSucceeded, {
                method: 'email',
                redirect_path: '/dashboard',
            });
            setSuccess(true);
            setLoading(false);
            // Redirect to dashboard after 2 seconds
            setTimeout(() => router.push('/dashboard'), 2000);
        }
    };

    const handleGoogleSignup = async () => {
        setLoading(true);
        setError(null);
        captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupStarted, {
            method: 'google',
        });

        const { error } = await signInWithGoogle();

        if (error) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.authSignupFailed, {
                method: 'google',
                error_type: error.message,
            });
            setError(error.message);
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4 py-8">
            <div className="w-full max-w-md space-y-8 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 sm:p-8">
                <div>
                    <div className="flex justify-center">
                        <VniBBLogo width={144} label={null} />
                    </div>
                    <h2 className="mt-4 text-center text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
                        Create your {VNIBB_BRAND_NAME} account
                    </h2>
                    <p className="mt-2 text-center text-sm text-[var(--text-secondary)]">
                        {VNIBB_BRAND_DESCRIPTOR}
                    </p>
                </div>

                {error && (
                    <div className="rounded border border-[var(--color-error)]/40 bg-[var(--color-state-bg)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-4 py-3 text-sm text-[var(--text-primary)]">
                        Account created successfully! Redirecting...
                    </div>
                )}

                <form onSubmit={handleSignup} className="mt-8 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-[var(--text-secondary)]">
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
                                className="mt-1 block w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)]">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="new-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="mt-1 block w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                                placeholder="••••••••"
                            />
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--text-secondary)]">
                                Confirm Password
                            </label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type="password"
                                autoComplete="new-password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="mt-1 block w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                                placeholder="••••••••"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex w-full justify-center rounded-md bg-[var(--color-accent-fill)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? 'Creating account...' : 'Sign up'}
                    </button>
                </form>

                <div className="mt-6">
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-[var(--border-subtle)]"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="bg-[var(--bg-secondary)] px-2 text-[var(--text-muted)]">Or continue with</span>
                        </div>
                    </div>

                    <div className="mt-6">
                        <button
                            onClick={handleGoogleSignup}
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path
                                    fill="currentColor"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                            Sign up with Google
                        </button>
                    </div>
                </div>

                <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
                    Already have an account?{' '}
                    <Link href="/login" className="font-medium text-[var(--accent-blue)] hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
