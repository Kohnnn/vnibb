/**
 * Widget Error Boundary Component
 * 
 * Catches JavaScript errors in widget components and displays
 * user-friendly error messages with retry capability.
 */

'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logClientError } from '@/lib/clientLogger';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  widgetName?: string;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error for debugging
    logClientError(`Widget error in ${this.props.widgetName || 'Unknown'}:`, error, errorInfo);

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleHardReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI. Copy is intentionally calm so users don't panic
      // on transient render hiccups; "Retry widget" reuses the same React
      // tree (cheap), "Reload page" is a hard reset for stuck states.
      return (
        <div className="widget-error">
          <div className="widget-error__icon">
            <AlertTriangle size={32} />
          </div>
          <div className="widget-error__content">
            <h4 className="widget-error__title">
              {this.props.widgetName ? `${this.props.widgetName} hit a snag` : 'Widget hit a snag'}
            </h4>
            <p className="widget-error__message">
              Something went wrong while rendering. The rest of the dashboard is unaffected.
            </p>
            {this.state.error && (
              <p className="widget-error__detail" title={this.state.error.message}>
                {this.state.error.message.length > 140
                  ? `${this.state.error.message.slice(0, 140)}…`
                  : this.state.error.message}
              </p>
            )}
          </div>
          <div className="widget-error__actions">
            <button
              className="widget-error__retry"
              onClick={this.handleRetry}
              type="button"
            >
              <RefreshCw size={14} />
              <span>Retry widget</span>
            </button>
            <button
              className="widget-error__retry widget-error__retry--secondary"
              onClick={this.handleHardReload}
              type="button"
            >
              <span>Reload page</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

