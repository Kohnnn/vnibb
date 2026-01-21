/**
 * Widget Error Boundary Component
 * 
 * Catches JavaScript errors in widget components and displays
 * user-friendly error messages with retry capability.
 */

'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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
    console.error(`Widget error in ${this.props.widgetName || 'Unknown'}:`, error, errorInfo);

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

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="widget-error">
          <div className="widget-error__icon">
            <AlertTriangle size={32} />
          </div>
          <div className="widget-error__content">
            <h4 className="widget-error__title">Something went wrong</h4>
            <p className="widget-error__message">
              {this.props.widgetName
                ? `The ${this.props.widgetName} widget encountered an error.`
                : 'This widget encountered an error.'}
            </p>
            {this.state.error && (
              <p className="widget-error__detail">
                {this.state.error.message}
              </p>
            )}
          </div>
          <button
            className="widget-error__retry"
            onClick={this.handleRetry}
          >
            <RefreshCw size={16} />
            <span>Try Again</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based error boundary wrapper for functional components
 */
interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
  widgetName?: string;
}

export const WidgetErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  widgetName,
}) => (
  <div className="widget-error">
    <div className="widget-error__icon">
      <AlertTriangle size={32} />
    </div>
    <div className="widget-error__content">
      <h4 className="widget-error__title">Something went wrong</h4>
      <p className="widget-error__message">
        {widgetName
          ? `The ${widgetName} widget encountered an error.`
          : 'This widget encountered an error.'}
      </p>
      <p className="widget-error__detail">{error.message}</p>
    </div>
    <button className="widget-error__retry" onClick={resetError}>
      <RefreshCw size={16} />
      <span>Try Again</span>
    </button>
  </div>
);

/**
 * Empty State Component
 * For when data is empty but not an error
 */
interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const WidgetEmptyState: React.FC<EmptyStateProps> = ({
  title = 'No data available',
  message = 'There is no data to display at this time.',
  icon,
  action,
}) => (
  <div className="widget-empty">
    {icon && <div className="widget-empty__icon">{icon}</div>}
    <h4 className="widget-empty__title">{title}</h4>
    <p className="widget-empty__message">{message}</p>
    {action && (
      <button className="widget-empty__action" onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

/**
 * Loading State Component
 * Simple loading indicator for widgets
 */
interface LoadingStateProps {
  message?: string;
}

export const WidgetLoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
}) => (
  <div className="widget-loading">
    <div className="widget-loading__spinner" />
    <p className="widget-loading__message">{message}</p>
  </div>
);
