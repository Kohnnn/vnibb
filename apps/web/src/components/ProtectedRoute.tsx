/**
 * Protected Route Component
 * 
 * Keeps dashboard routes open by default while tenant auth remains a roadmap item.
 * Set NEXT_PUBLIC_ENABLE_AUTH=true to opt into login enforcement.
 */

"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { env } from '@/lib/env';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { user, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (env.authBypassEnabled) {
            return;
        }

        if (!loading && !user) {
            // Redirect to login with return URL
            router.replace(`/login?redirectTo=${encodeURIComponent(pathname)}`);
        }
    }, [user, loading, router, pathname]);

    if (env.authBypassEnabled) {
        return <>{children}</>;
    }

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
}
