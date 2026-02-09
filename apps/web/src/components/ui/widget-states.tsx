'use client';

import { AlertCircle, AlertTriangle, RefreshCw, Wifi, WifiOff, Inbox, Loader2 } from 'lucide-react';
import React from 'react';

/**
 * Common widget state components for consistent UX
 */

export function WidgetLoading({ message = 'Loading data...' }: { message?: string }) {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[120px] p-4 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-3" />
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
                {message}
            </p>
        </div>
    );
}

/**
 * Convert technical error messages to user-friendly ones
 */


interface WidgetErrorProps {
    error?: Error | null;
    onRetry?: () => void;
    title?: string;
}

/**
 * Standardized error display for widgets
 * Shows friendly error message with retry button
 */
export function WidgetError({ error, onRetry, title = 'Failed to load data' }: WidgetErrorProps) {
    const message = error?.message || '';
    const lowerMessage = message.toLowerCase();
    const isMixedContent = lowerMessage.includes('mixed content');
    const isNetworkError = lowerMessage.includes('fetch') || lowerMessage.includes('network') || lowerMessage.includes('offline');
    const isTimeout = lowerMessage.includes('timeout') || lowerMessage.includes('timed out');
    const isRateLimit = lowerMessage.includes('429') || lowerMessage.includes('too many requests');
    const isUnauthorized = lowerMessage.includes('401') || lowerMessage.includes('unauthorized');
    const isForbidden = lowerMessage.includes('403') || lowerMessage.includes('forbidden');
    const isNotFound = lowerMessage.includes('404') || lowerMessage.includes('not found');

    const resolvedTitle = title !== 'Failed to load data'
        ? title
        : isMixedContent
            ? 'Mixed Content Blocked'
            : isNetworkError
                ? 'Connection Failed'
                : isTimeout
                    ? 'Request Timed Out'
                    : isRateLimit
                        ? 'Too Many Requests'
                        : isUnauthorized
                            ? 'Authentication Required'
                            : isForbidden
                                ? 'Access Denied'
                                : isNotFound
                                    ? 'Data Not Found'
                                    : 'Something Went Wrong';

    const hint = isNetworkError
        ? 'Check your connection and try again.'
        : isMixedContent
            ? 'Ensure the API URL uses HTTPS and the backend supports TLS.'
            : isTimeout
                ? 'The server took too long to respond.'
                : isRateLimit
                    ? 'Please wait a moment before retrying.'
                    : null;

    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[140px] p-4 text-center">
            <div className="flex items-center gap-2 text-red-400 mb-3">
                {isNetworkError ? <WifiOff size={18} /> : <AlertCircle size={18} />}
                <span className="text-sm font-medium">{resolvedTitle}</span>
            </div>

            {message && (
                <p className="text-xs text-gray-500 mb-4 max-w-[280px] leading-relaxed">
                    {getUserFriendlyErrorMessage(message)}
                </p>
            )}

            {hint && (
                <p className="text-[11px] text-gray-600 mb-3">{hint}</p>
            )}

            {onRetry && (
                <button
                    onClick={onRetry}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors"
                >
                    <RefreshCw size={12} />
                    {isTimeout ? 'Retry' : 'Try Again'}
                </button>
            )}
        </div>
    );
}

/**
 * Network offline indicator
 */
export function OfflineIndicator() {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[100px] p-4 text-center">
            <WifiOff size={20} className="text-gray-500 mb-2" />
            <p className="text-xs text-gray-500 font-medium">You're offline</p>
            <p className="text-xs text-gray-600 mt-1">Check your connection</p>
        </div>
    );
}

/**
 * Empty state for widgets with no data
 */
interface WidgetEmptyProps {
    message?: string;
    icon?: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
    };
}

export function WidgetEmpty({
    message = 'No data available',
    icon,
    action
}: WidgetEmptyProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[120px] p-4 text-center">
            <div className="text-gray-600 mb-2">
                {icon || <Inbox size={24} />}
            </div>
            <p className="text-xs text-gray-500 font-medium mb-3">{message}</p>
            {action && (
                <button
                    onClick={action.onClick}
                    className="px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}

/**
 * Compact error indicator for smaller widgets
 */
export function CompactError({ message = 'Error', onRetry }: { message?: string; onRetry?: () => void }) {
    return (
        <div className="flex items-center justify-center gap-2 p-3 text-amber-400">
            <AlertTriangle size={14} />
            <span className="text-xs">{message}</span>
            {onRetry && (
                <button onClick={onRetry} className="ml-1 hover:bg-gray-800/50 rounded p-1">
                    <RefreshCw size={10} />
                </button>
            )}
        </div>
    );
}

/**
 * Network status badge
 */
export function NetworkStatus({ isOnline }: { isOnline: boolean }) {
    return (
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${isOnline ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}>
            {isOnline ? <Wifi size={10} /> : <WifiOff size={10} />}
            {isOnline ? 'Online' : 'Offline'}
        </div>
    );
}

/**
 * Convert technical error messages to user-friendly ones
 */
function getUserFriendlyErrorMessage(message: string): string {
    // Mixed content errors
    if (message.toLowerCase().includes('mixed content')) {
        return 'Secure pages can only call HTTPS APIs. Update your API URL to https://.';
    }

    // Network errors
    if (message.includes('fetch') || message.includes('NetworkError')) {
        return 'Unable to connect to the server. Please check your internet connection.';
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out')) {
        return 'Request took too long. The server might be busy, please try again.';
    }

    // 4xx errors
    if (message.includes('400') || message.includes('Bad Request')) {
        return 'Invalid request. Please refresh the page.';
    }

    if (message.includes('401') || message.includes('Unauthorized')) {
        return 'You need to log in to view this data.';
    }

    if (message.includes('403') || message.includes('Forbidden')) {
        return 'You don\'t have permission to access this data.';
    }

    if (message.includes('404') || message.includes('Not Found')) {
        return 'The requested data could not be found.';
    }

    // 5xx errors
    if (message.includes('500') || message.includes('Internal Server')) {
        return 'Server error. Our team has been notified.';
    }

    if (message.includes('502') || message.includes('503') || message.includes('Bad Gateway') || message.includes('Service Unavailable')) {
        return 'Service temporarily unavailable. Please try again in a moment.';
    }

    // Rate limiting
    if (message.includes('429') || message.includes('Too Many Requests')) {
        return 'Too many requests. Please wait a moment before trying again.';
    }

    // Default fallback
    return message.length > 100 ? 'An unexpected error occurred. Please try again.' : message;
}

export { getUserFriendlyErrorMessage };
