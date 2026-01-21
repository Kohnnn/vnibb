/**
 * Authentication Context
 * 
 * Provides authentication state and methods throughout the application.
 * Includes Google OAuth, admin testing mode, and guest read-only mode.
 */

"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// Feature flags from environment
const ENABLE_ADMIN_LOGIN = process.env.NEXT_PUBLIC_ENABLE_ADMIN_LOGIN === 'true';
const ENABLE_GUEST_LOGIN = process.env.NEXT_PUBLIC_ENABLE_GUEST_LOGIN === 'true';

// Mock users for development/testing
const ADMIN_USER: Partial<User> = {
    id: 'admin-antigravity-test',
    email: 'admin@antigravity.test',
    user_metadata: { role: 'admin', display_name: 'Antigravity Admin' },
    role: 'authenticated',
};

const GUEST_USER: Partial<User> = {
    id: 'guest-vnibb-readonly',
    email: 'guest@vnibb.app',
    user_metadata: { role: 'guest', display_name: 'Guest User' },
    role: 'authenticated',
};

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    isConfigured: boolean;
    isAdmin: boolean;
    isGuest: boolean;
    signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signInWithGoogle: () => Promise<{ error: AuthError | null }>;
    signInWithMagicLink: (email: string) => Promise<{ error: AuthError | null }>;
    signInAsAdmin: () => void;
    signInAsGuest: () => void;
    signOut: () => Promise<void>;
    canAdminLogin: boolean;
    canGuestLogin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDevMode, setIsDevMode] = useState(false);

    // Derived state
    const isAdmin = user?.user_metadata?.role === 'admin';
    const isGuest = user?.user_metadata?.role === 'guest';

    useEffect(() => {
        // Check for dev mode (admin/guest sessions in localStorage)
        const devUser = localStorage.getItem('vnibb_dev_user');
        if (devUser) {
            try {
                const parsed = JSON.parse(devUser);
                setUser(parsed as User);
                setIsDevMode(true);
                setLoading(false);
                return;
            } catch {
                localStorage.removeItem('vnibb_dev_user');
            }
        }

        if (!supabase || !isSupabaseConfigured) {
            setLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string) => {
        if (!supabase) {
            return { error: { message: 'Supabase not configured' } as AuthError };
        }
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        return { error };
    };

    const signUp = async (email: string, password: string) => {
        if (!supabase) {
            return { error: { message: 'Supabase not configured' } as AuthError };
        }
        const { error } = await supabase.auth.signUp({
            email,
            password,
        });
        return { error };
    };

    const signInWithGoogle = async () => {
        if (!supabase) {
            return { error: { message: 'Supabase not configured' } as AuthError };
        }
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        return { error };
    };

    const signInWithMagicLink = async (email: string) => {
        if (!supabase) {
            return { error: { message: 'Supabase not configured' } as AuthError };
        }
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        return { error };
    };

    /**
     * DEVELOPMENT ONLY: Sign in as admin for Antigravity testing
     * This bypasses OAuth and creates a mock admin session.
     * REMOVE BEFORE PRODUCTION - see docs/TESTING_ACCOUNTS.md
     */
    const signInAsAdmin = () => {
        if (!ENABLE_ADMIN_LOGIN) {
            console.warn('Admin login is disabled. Set NEXT_PUBLIC_ENABLE_ADMIN_LOGIN=true');
            return;
        }
        localStorage.setItem('vnibb_dev_user', JSON.stringify(ADMIN_USER));
        setUser(ADMIN_USER as User);
        setIsDevMode(true);
    };

    /**
     * Guest login: Read-only access without full authentication.
     * Guest users can view dashboards but cannot modify data.
     */
    const signInAsGuest = () => {
        if (!ENABLE_GUEST_LOGIN) {
            console.warn('Guest login is disabled. Set NEXT_PUBLIC_ENABLE_GUEST_LOGIN=true');
            return;
        }
        localStorage.setItem('vnibb_dev_user', JSON.stringify(GUEST_USER));
        setUser(GUEST_USER as User);
        setIsDevMode(true);
    };

    const signOut = async () => {
        // Clear dev mode
        if (isDevMode) {
            localStorage.removeItem('vnibb_dev_user');
            setUser(null);
            setIsDevMode(false);
            return;
        }

        if (!supabase) return;
        await supabase.auth.signOut();
    };

    const value = {
        user,
        session,
        loading,
        isConfigured: isSupabaseConfigured,
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
