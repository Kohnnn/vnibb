/**
 * Authentication Context
 *
 * Provides authentication state and methods throughout the application.
 * Supports Supabase (default) and Appwrite (migration path) providers.
 */

"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getDashboardClientId } from '@/lib/api';
import { identifyAnalyticsUser, resetAnalytics } from '@/lib/analytics';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
    authProvider,
    appwriteClearSessionHint,
    isAppwriteConfigured,
    appwriteCreateOAuth2Url,
    appwriteGetAccount,
    appwriteRememberSessionHint,
    appwriteSendMagicLink,
    appwriteSignInWithEmail,
    appwriteSignOutCurrentSession,
    appwriteSignUp,
    appwriteShouldBootstrapSession,
    isAppwriteUnauthorizedError,
} from '@/lib/appwrite';

// Feature flags from environment
const ENABLE_ADMIN_LOGIN = process.env.NEXT_PUBLIC_ENABLE_ADMIN_LOGIN === 'true';
const ENABLE_GUEST_LOGIN = process.env.NEXT_PUBLIC_ENABLE_GUEST_LOGIN === 'true';

type AuthProviderName = 'supabase' | 'appwrite' | 'dev';

export interface AuthUser {
    id: string;
    email: string | null;
    user_metadata: Record<string, unknown>;
    role?: string;
    provider: AuthProviderName;
}

export interface AuthSession {
    provider: AuthProviderName;
    raw?: unknown;
}

export interface AuthFailure {
    message: string;
}

// Mock users for development/testing
const ADMIN_USER: AuthUser = {
    id: 'admin-antigravity-test',
    email: 'admin@antigravity.test',
    user_metadata: { role: 'admin', display_name: 'Antigravity Admin' },
    role: 'authenticated',
    provider: 'dev',
};

const GUEST_USER: AuthUser = {
    id: 'guest-vnibb-readonly',
    email: 'guest@vnibb.app',
    user_metadata: { role: 'guest', display_name: 'Guest User' },
    role: 'authenticated',
    provider: 'dev',
};

interface AuthContextType {
    user: AuthUser | null;
    session: AuthSession | null;
    loading: boolean;
    isConfigured: boolean;
    provider: AuthProviderName;
    isAdmin: boolean;
    isGuest: boolean;
    signIn: (email: string, password: string) => Promise<{ error: AuthFailure | null }>;
    signUp: (email: string, password: string) => Promise<{ error: AuthFailure | null }>;
    signInWithGoogle: () => Promise<{ error: AuthFailure | null }>;
    signInWithMagicLink: (email: string) => Promise<{ error: AuthFailure | null }>;
    signInAsAdmin: () => void;
    signInAsGuest: () => void;
    signOut: () => Promise<void>;
    canAdminLogin: boolean;
    canGuestLogin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const appwriteEnabled = authProvider === 'appwrite';

function toAuthFailure(error: unknown, fallback = 'Authentication failed'): AuthFailure {
    if (error instanceof Error && error.message) {
        return { message: error.message };
    }
    return { message: fallback };
}

function mapSupabaseUser(user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
    role?: string;
}): AuthUser {
    return {
        id: user.id,
        email: user.email ?? null,
        user_metadata: user.user_metadata ?? {},
        role: user.role,
        provider: 'supabase',
    };
}

function mapAppwriteUser(user: {
    $id: string;
    email?: string;
    prefs?: Record<string, unknown>;
}): AuthUser {
    return {
        id: user.$id,
        email: user.email ?? null,
        user_metadata: user.prefs ?? {},
        role: 'authenticated',
        provider: 'appwrite',
    };
}

function parseDevUser(raw: string): AuthUser | null {
    try {
        const parsed = JSON.parse(raw) as Partial<AuthUser>;
        if (!parsed?.id) return null;
        return {
            id: parsed.id,
            email: parsed.email ?? null,
            user_metadata: parsed.user_metadata ?? {},
            role: parsed.role,
            provider: 'dev',
        };
    } catch {
        return null;
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [session, setSession] = useState<AuthSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDevMode, setIsDevMode] = useState(false);
    const lastIdentifiedUserIdRef = useRef<string | null>(null);

    // Derived state
    const isAdmin = user?.user_metadata?.role === 'admin';
    const isGuest = user?.user_metadata?.role === 'guest';

    useEffect(() => {
        // Check for dev mode (admin/guest sessions in localStorage)
        const devUserRaw = localStorage.getItem('vnibb_dev_user');
        if (devUserRaw) {
            const devUser = parseDevUser(devUserRaw);
            if (devUser) {
                setUser(devUser);
                setSession({ provider: 'dev' });
                setIsDevMode(true);
                setLoading(false);
                return;
            }
            localStorage.removeItem('vnibb_dev_user');
        }

        if (appwriteEnabled) {
            if (!isAppwriteConfigured) {
                setLoading(false);
                return;
            }

            if (!appwriteShouldBootstrapSession()) {
                setLoading(false);
                return;
            }

            appwriteGetAccount()
                .then((account) => {
                    appwriteRememberSessionHint();
                    setUser(mapAppwriteUser(account));
                    setSession({ provider: 'appwrite', raw: account });
                })
                .catch((error) => {
                    if (isAppwriteUnauthorizedError(error)) {
                        appwriteClearSessionHint();
                    }
                    setUser(null);
                    setSession(null);
                })
                .finally(() => {
                    setLoading(false);
                });

            return;
        }

        if (!supabase || !isSupabaseConfigured) {
            setLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session: supabaseSession } }) => {
            setSession({ provider: 'supabase', raw: supabaseSession });
            setUser(supabaseSession?.user ? mapSupabaseUser(supabaseSession.user) : null);
            setLoading(false);
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, supabaseSession) => {
            setSession({ provider: 'supabase', raw: supabaseSession });
            setUser(supabaseSession?.user ? mapSupabaseUser(supabaseSession.user) : null);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (user) {
            identifyAnalyticsUser({
                id: user.id,
                email: user.email,
                role: typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : user.role,
                provider: user.provider,
            });
            lastIdentifiedUserIdRef.current = user.id;
            return;
        }

        if (lastIdentifiedUserIdRef.current) {
            resetAnalytics({ clientId: getDashboardClientId() });
            lastIdentifiedUserIdRef.current = null;
        }
    }, [user]);

    const signIn = async (email: string, password: string) => {
        if (appwriteEnabled) {
            if (!isAppwriteConfigured) {
                return { error: { message: 'Appwrite not configured' } };
            }

            try {
                await appwriteSignInWithEmail(email, password);
                const account = await appwriteGetAccount();
                appwriteRememberSessionHint();
                setUser(mapAppwriteUser(account));
                setSession({ provider: 'appwrite', raw: account });
                return { error: null };
            } catch (error) {
                return { error: toAuthFailure(error) };
            }
        }

        if (!supabase) {
            return { error: { message: 'Supabase not configured' } };
        }

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        return { error: error ? { message: error.message } : null };
    };

    const signUp = async (email: string, password: string) => {
        if (appwriteEnabled) {
            if (!isAppwriteConfigured) {
                return { error: { message: 'Appwrite not configured' } };
            }

            try {
                await appwriteSignUp(email, password);
                await appwriteSignInWithEmail(email, password);
                const account = await appwriteGetAccount();
                appwriteRememberSessionHint();
                setUser(mapAppwriteUser(account));
                setSession({ provider: 'appwrite', raw: account });
                return { error: null };
            } catch (error) {
                return { error: toAuthFailure(error) };
            }
        }

        if (!supabase) {
            return { error: { message: 'Supabase not configured' } };
        }

        const { error } = await supabase.auth.signUp({
            email,
            password,
        });

        return { error: error ? { message: error.message } : null };
    };

    const signInWithGoogle = async () => {
        if (appwriteEnabled) {
            if (!isAppwriteConfigured) {
                return { error: { message: 'Appwrite not configured' } };
            }

            if (typeof window === 'undefined') {
                return { error: { message: 'Google sign-in requires browser context' } };
            }

            const callbackUrl = `${window.location.origin}/auth/callback`;
            const failureUrl = `${window.location.origin}/login?error=oauth_failed`;
            window.location.assign(appwriteCreateOAuth2Url('google', callbackUrl, failureUrl));
            return { error: null };
        }

        if (!supabase) {
            return { error: { message: 'Supabase not configured' } };
        }

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        return { error: error ? { message: error.message } : null };
    };

    const signInWithMagicLink = async (email: string) => {
        if (appwriteEnabled) {
            if (!isAppwriteConfigured) {
                return { error: { message: 'Appwrite not configured' } };
            }

            if (typeof window === 'undefined') {
                return { error: { message: 'Magic link requires browser context' } };
            }

            try {
                const callbackUrl = `${window.location.origin}/auth/callback`;
                await appwriteSendMagicLink(email, callbackUrl);
                return { error: null };
            } catch (error) {
                return { error: toAuthFailure(error, 'Failed to send magic link') };
            }
        }

        if (!supabase) {
            return { error: { message: 'Supabase not configured' } };
        }

        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        return { error: error ? { message: error.message } : null };
    };

    /**
     * DEVELOPMENT ONLY: Sign in as admin for Antigravity testing
     * This bypasses provider auth and creates a mock admin session.
     */
    const signInAsAdmin = () => {
        if (!ENABLE_ADMIN_LOGIN) {
            console.warn('Admin login is disabled. Set NEXT_PUBLIC_ENABLE_ADMIN_LOGIN=true');
            return;
        }
        localStorage.setItem('vnibb_dev_user', JSON.stringify(ADMIN_USER));
        setUser(ADMIN_USER);
        setSession({ provider: 'dev' });
        setIsDevMode(true);
    };

    /**
     * Guest login: Read-only access without full authentication.
     */
    const signInAsGuest = () => {
        if (!ENABLE_GUEST_LOGIN) {
            console.warn('Guest login is disabled. Set NEXT_PUBLIC_ENABLE_GUEST_LOGIN=true');
            return;
        }
        localStorage.setItem('vnibb_dev_user', JSON.stringify(GUEST_USER));
        setUser(GUEST_USER);
        setSession({ provider: 'dev' });
        setIsDevMode(true);
    };

    const signOut = async () => {
        // Clear dev mode
        if (isDevMode) {
            localStorage.removeItem('vnibb_dev_user');
            setUser(null);
            setSession(null);
            setIsDevMode(false);
            return;
        }

        if (appwriteEnabled) {
            if (!isAppwriteConfigured) {
                appwriteClearSessionHint();
                setUser(null);
                setSession(null);
                return;
            }

            try {
                await appwriteSignOutCurrentSession();
            } catch (error) {
                console.warn('Appwrite sign out failed:', toAuthFailure(error).message);
            } finally {
                appwriteClearSessionHint();
                setUser(null);
                setSession(null);
            }
            return;
        }

        if (!supabase) return;
        await supabase.auth.signOut();
    };

    const activeProvider: AuthProviderName = isDevMode
        ? 'dev'
        : appwriteEnabled
            ? 'appwrite'
            : 'supabase';

    const value = {
        user,
        session,
        loading,
        isConfigured: appwriteEnabled ? isAppwriteConfigured : isSupabaseConfigured,
        provider: activeProvider,
        isAdmin,
        isGuest,
        signIn,
        signUp,
        signInWithGoogle,
        signInWithMagicLink,
        signInAsAdmin,
        signInAsGuest,
        signOut,
        canAdminLogin: ENABLE_ADMIN_LOGIN,
        canGuestLogin: ENABLE_GUEST_LOGIN,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
