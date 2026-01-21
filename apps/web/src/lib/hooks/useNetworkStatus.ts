'use client';

import { useEffect, useState } from 'react';

/**
 * Hook to detect network online/offline status
 * Updates when connection changes
 */
export function useOnlineStatus() {
    const [isOnline, setIsOnline] = useState(
        typeof window !== 'undefined' ? navigator.onLine : true
    );

    useEffect(() => {
        function handleOnline() {
            setIsOnline(true);
        }

        function handleOffline() {
            setIsOnline(false);
        }

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
}

/**
 * Hook to detect when the system is rate-limited
 * Useful for showing appropriate messages
 */
export function useRateLimitDetection() {
    const [isRateLimited, setIsRateLimited] = useState(false);

    const markRateLimited = () => {
        setIsRateLimited(true);
        // Auto-reset after 1 minute
        setTimeout(() => setIsRateLimited(false), 60000);
    };

    return { isRateLimited, markRateLimited };
}
