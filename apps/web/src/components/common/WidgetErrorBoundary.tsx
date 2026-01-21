// ErrorBoundary component to catch and handle widget crashes gracefully

'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    widgetType?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Widget Error:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                    <AlertTriangle size={32} className="text-amber-500 mb-3" />
                    <h3 className="text-sm font-medium text-gray-300 mb-1">
                        Widget Error
                    </h3>
                    <p className="text-xs text-gray-500 mb-3 max-w-[200px]">
                        {this.props.widgetType
                            ? `The ${this.props.widgetType} widget encountered an error.`
                            : 'This widget encountered an error.'}
                    </p>
                    <button
                        onClick={this.handleReset}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded transition-colors"
                    >
                        <RefreshCw size={12} />
                        Retry
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

// HOC to wrap widgets with error boundary
export function withErrorBoundary<P extends object>(
    WrappedComponent: React.ComponentType<P>,
    widgetType: string
) {
    return function WithErrorBoundaryWrapper(props: P) {
        return (
            <WidgetErrorBoundary widgetType={widgetType}>
                <WrappedComponent {...props} />
            </WidgetErrorBoundary>
        );
    };
}
