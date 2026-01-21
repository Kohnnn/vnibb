/**
 * Protected Route Component
 * 
 * Wraps pages that require authentication.
 * Redirects to login if user is not authenticated.
 */

"use client";

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    // ================================================================
    // 🚨 TEMP: AUTH DISABLED PER USER REQUEST (2026-01-15)
    // ================================================================
    // User requested: "Please suspend the login screen for now, 
    // i will enable it after site work"
    //
    // TO RE-ENABLE AUTH: Uncomment the code below and remove this return
    // ================================================================

    return <>{children}</>;

    /* ORIGINAL AUTH CODE - COMMENTED OUT TEMPORARILY
    const { user, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!loading && !user) {
            // Redirect to login with return URL
            router.push(`/login?redirectTo=${encodeURIComponent(pathname)}`);
        }
    }, [user, loading, router, pathname]);

    // Show loading state
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                    <p className="mt-4 text-zinc-400">Loading...</p>
                </div>
            </div>
        );
    }

    // Don't render anything if not authenticated
    if (!user) {
        return null;
    }

    // Render children if authenticated
    return <>{children}</>;
    */
}
