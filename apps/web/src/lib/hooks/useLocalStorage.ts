// useLocalStorage hook - Type-safe localStorage with SSR support
'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for persisting state to localStorage with SSR safety.
 * Handles storage quota errors and provides type-safe access.
 */
export function useLocalStorage<T>(
    key: string,
    initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
    // Initialize with initialValue to avoid hydration mismatch
    const [storedValue, setStoredValue] = useState<T>(initialValue);
    const [isHydrated, setIsHydrated] = useState(false);

    // Load from localStorage after mount (client-side only)
    useEffect(() => {
        try {
            const item = window.localStorage.getItem(key);
            if (item !== null) {
                const parsed = JSON.parse(item) as T;
                setStoredValue(parsed);
            }
        } catch (error) {
            console.warn(`Error reading localStorage key "${key}":`, error);
        }
        setIsHydrated(true);
    }, [key]);

    // Setter function with storage quota error handling
    const setValue = useCallback(
        (value: T | ((prev: T) => T)) => {
            try {
                const valueToStore = value instanceof Function ? value(storedValue) : value;
                setStoredValue(valueToStore);

                if (typeof window !== 'undefined') {
                    window.localStorage.setItem(key, JSON.stringify(valueToStore));
                }
            } catch (error) {
                // Handle storage quota exceeded
                if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    console.error('localStorage quota exceeded. Consider clearing old data.');
                } else {
                    console.warn(`Error setting localStorage key "${key}":`, error);
                }
            }
        },
        [key, storedValue]
    );

    // Clear function to remove the key
    const clearValue = useCallback(() => {
        try {
            setStoredValue(initialValue);
            if (typeof window !== 'undefined') {
                window.localStorage.removeItem(key);
            }
        } catch (error) {
            console.warn(`Error clearing localStorage key "${key}":`, error);
        }
    }, [key, initialValue]);

    return [storedValue, setValue, clearValue];
}
