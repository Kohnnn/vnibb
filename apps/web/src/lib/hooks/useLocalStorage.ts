// useLocalStorage hook - Type-safe localStorage with SSR support
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { logClientError, logClientWarn } from '@/lib/clientLogger';

/**
 * Custom hook for persisting state to localStorage with SSR safety.
 * Handles storage quota errors and provides type-safe access.
 */
export function useLocalStorage<T>(
    key: string,
    initialValue: T
): [T, (value: T | ((prev: T) => T)) => boolean, () => boolean, string | null] {
    // Initialize with initialValue to avoid hydration mismatch
    const [storedValue, setStoredValue] = useState<T>(initialValue);
    const committedValue = useRef(storedValue);
    const [storageError, setStorageError] = useState<string | null>(null);
    // Load from localStorage after mount (client-side only)
    useEffect(() => {
        try {
            const item = window.localStorage.getItem(key);
            if (item !== null) {
                const parsed = JSON.parse(item) as T;
                committedValue.current = parsed;
                setStoredValue(parsed);
            }
        } catch (error) {
            logClientWarn(`Error reading localStorage key "${key}":`, error);
        }
    }, [key]);

    const setValue = useCallback(
        (value: T | ((prev: T) => T)): boolean => {
            try {
                const next = value instanceof Function ? value(committedValue.current) : value;
                window.localStorage.setItem(key, JSON.stringify(next));
                committedValue.current = next;
                setStoredValue(next);
                setStorageError(null);
                return true;
            } catch (error) {
                if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    logClientError('localStorage quota exceeded. Consider clearing old data.');
                } else {
                    logClientWarn(`Error setting localStorage key "${key}":`, error);
                }
                setStorageError('Could not save holdings to browser storage. Your last saved holdings remain available; free browser storage or check permissions, then retry.');
                return false;
            }
        },
        [key]
    );

    const clearValue = useCallback((): boolean => {
        try {
            window.localStorage.removeItem(key);
            committedValue.current = initialValue;
            setStoredValue(initialValue);
            setStorageError(null);
            return true;
        } catch (error) {
            logClientWarn(`Error clearing localStorage key "${key}":`, error);
            setStorageError('Could not clear holdings from browser storage. Your last saved holdings remain available; check browser storage and retry.');
            return false;
        }
    }, [key, initialValue]);

    return [storedValue, setValue, clearValue, storageError];
}
