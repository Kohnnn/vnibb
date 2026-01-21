// Error Boundary for catching React component errors

'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    onReset?: () => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error Boundary component that catches JavaScript errors in child components.
 * Displays a fallback UI and provides a retry mechanism.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error('Widget Error:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex flex-col items-center justify-center h-full min-h-[120px] p-4 text-center">
                    <div className="flex items-center gap-2 text-red-400 mb-3">
                        <AlertTriangle size={20} />
                        <span className="text-sm font-medium">Something went wrong</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3 max-w-[200px]">
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button
                        onClick={this.handleReset}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors"
                    >
                        <RefreshCw size={12} />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Lightweight error fallback component for widgets
 */
export function WidgetErrorFallback({
    message = 'Failed to load widget',
    onRetry
}: {
    message?: string;
    onRetry?: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[80px] p-3">
            <div className="flex items-center gap-1.5 text-amber-400 mb-2">
                <AlertTriangle size={14} />
                <span className="text-xs font-medium">{message}</span>
            </div>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                >
                    <RefreshCw size={10} />
                    Retry
                </button>
            )}
        </div>
    );
}
