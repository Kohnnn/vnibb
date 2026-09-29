/**
 * Authentication Context
 *
 * Provides authentication state and methods throughout the application.
 * Backed exclusively by Supabase.
 */

"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getAdminSession, getDashboardClientId } from '@/lib/api';
import { clearLegacyAdminLayoutCredentials } from '@/lib/adminLayoutAccess';
import { identifyAnalyticsUser, resetAnalytics } from '@/lib/analytics';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// Feature flags from environment
const ENABLE_ADMIN_LOGIN = process.env.NEXT_PUBLIC_ENABLE_ADMIN_LOGIN === 'true';
const ENABLE_GUEST_LOGIN = process.env.NEXT_PUBLIC_ENABLE_GUEST_LOGIN === 'true';

type AuthProviderName = 'supabase' | 'dev';

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
    adminStatus: 'signed-out' | 'checking' | 'authorized' | 'denied';
    adminError: string | null;
    refreshAdminSession: () => void;
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
    const [adminAuthorization, setAdminAuthorization] = useState<{ token: string; userId: string; error: string | null } | null>(null);
    const [adminCheck, setAdminCheck] = useState(0);

    const accessToken = session?.provider === 'supabase'
        ? (session.raw as { access_token?: string } | null)?.access_token ?? null
        : null;
    const isAdmin = Boolean(accessToken && user?.provider === 'supabase' && adminAuthorization?.token === accessToken && adminAuthorization.userId === user.id && !adminAuthorization.error);
    const adminStatus: AuthContextType['adminStatus'] = !accessToken || !user || user.provider !== 'supabase'
        ? 'signed-out'
        : adminAuthorization?.token !== accessToken || adminAuthorization.userId !== user.id
            ? 'checking'
            : adminAuthorization.error ? 'denied' : 'authorized';
    const adminError = adminStatus === 'denied' ? adminAuthorization?.error ?? null : null;
    const isGuest = user?.user_metadata?.role === 'guest';

    useEffect(() => {
        clearLegacyAdminLayoutCredentials();
        setAdminCheck((value) => value + 1);
    }, []);

    useEffect(() => {
        if (!accessToken || !user || user.provider !== 'supabase') return;
        let active = true;
        void getAdminSession().then((admin) => {
            if (active) setAdminAuthorization((current) => current?.token === accessToken && current.error?.startsWith('Admin access was denied.')
                ? current : { token: accessToken, userId: user.id, error: admin.id === user.id && admin.role === 'admin' ? null : 'Admin session does not match your signed-in account.' });
        }).catch((error: unknown) => {
            if (active) setAdminAuthorization((current) => current?.token === accessToken && current.error?.startsWith('Admin access was denied.')
                ? current : { token: accessToken, userId: user.id, error: error instanceof Error ? error.message : 'Admin access denied.' });
        });
        return () => { active = false; };
    }, [accessToken, user?.id, user?.provider, adminCheck]);

    useEffect(() => {
        if (!accessToken || !user || user.provider !== 'supabase') return;
        const onAdminDenied = (event: Event) => {
            if ((event as CustomEvent<string>).detail === `Bearer ${accessToken}`) {
                setAdminAuthorization({ token: accessToken, userId: user.id, error: 'Admin access was denied. Sign in with an authorized account or ask an administrator to grant access.' });
            }
        };
        window.addEventListener('vnibb:admin-access-denied', onAdminDenied);
        return () => window.removeEventListener('vnibb:admin-access-denied', onAdminDenied);
    }, [accessToken, user?.id, user?.provider]);

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

        if (!supabase || !isSupabaseConfigured) {
            setLoading(false);
            return;
        }

        let receivedAuthEvent = false;
        // Get initial session
        supabase.auth.getSession().then(({ data: { session: supabaseSession } }) => {
            if (receivedAuthEvent) return;
            setSession({ provider: 'supabase', raw: supabaseSession });
            setUser(supabaseSession?.user ? mapSupabaseUser(supabaseSession.user) : null);
            setLoading(false);
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, supabaseSession) => {
            receivedAuthEvent = true;
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
            setAdminAuthorization(null);
            setUser(null);
            setSession(null);
            setIsDevMode(false);
            return;
        }

        if (!supabase) return;
        setAdminAuthorization(null);
        await supabase.auth.signOut();
    };

    const activeProvider: AuthProviderName = isDevMode ? 'dev' : 'supabase';

    const value = {
        user,
        session,
        loading,
        isConfigured: isSupabaseConfigured,
        provider: activeProvider,
        isAdmin,
        adminStatus,
        adminError,
        refreshAdminSession: () => { setAdminAuthorization(null); setAdminCheck((value) => value + 1); },
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
