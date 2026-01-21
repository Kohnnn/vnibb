/**
 * Frontend Monitoring & Observability
 * 
 * Provides monitoring utilities that work with or without Sentry installed.
 * Tracks Web Vitals (LCP, INP, CLS) for performance insights.
 * 
 * To enable Sentry monitoring:
 * 1. npm install @sentry/nextjs
 * 2. Set NEXT_PUBLIC_SENTRY_DSN in .env.local
 */

// Track if Sentry is initialized
let sentryInitialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SentryModule: any = null;

/**
 * Initialize monitoring. Safe to call even if Sentry is not installed.
 */
export async function initMonitoring(): Promise<void> {
  // Only initialize in browser
  if (typeof window === 'undefined') return;

  // Check if Sentry DSN is configured
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!sentryDsn) {
    console.info('[Monitoring] Sentry DSN not configured - using console logging');
    return;
  }

  try {
    // Dynamic import - will fail gracefully if @sentry/nextjs not installed
    // Using eval to prevent TypeScript from type-checking the module
    // eslint-disable-next-line no-eval
    SentryModule = await (eval('import("@sentry/nextjs")') as Promise<unknown>);

    if (!SentryModule?.init) {
      throw new Error('Invalid Sentry module');
    }

    SentryModule.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV,
      release: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      ignoreErrors: [
        'top.GLOBALS',
        'chrome-extension://',
        'NetworkError',
        'Failed to fetch',
      ],
    });

    sentryInitialized = true;
    console.info('[Monitoring] Sentry initialized successfully');
  } catch {
    console.info('[Monitoring] Sentry not available - using console logging');
  }
}

/**
 * Track Web Vitals metrics.
 */
export async function trackWebVitals(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const { onCLS, onINP, onLCP, onFCP, onTTFB } = await import('web-vitals');

    const reportVital = (metric: { name: string; value: number; rating: string }) => {
      if (sentryInitialized && SentryModule?.metrics?.distribution) {
        SentryModule.metrics.distribution(
          `web_vitals.${metric.name.toLowerCase()}`,
          metric.value,
          { unit: 'millisecond', tags: { rating: metric.rating } }
        );
      }

      // Always log to console in development
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[Web Vital] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`);
      }
    };

    onCLS(reportVital);
    onINP(reportVital);
    onLCP(reportVital);
    onFCP(reportVital);
    onTTFB(reportVital);
  } catch {
    console.warn('[Monitoring] Web Vitals not available');
  }
}

/**
 * Capture an exception.
 */
export function captureException(
  error: Error,
  context?: {
    tags?: Record<string, string>;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  }
): void {
  console.error('[Error]', error, context);

  if (sentryInitialized && SentryModule?.withScope) {
    SentryModule.withScope((scope: { setTag: (k: string, v: string) => void; setLevel: (l: string) => void }) => {
      if (context?.tags) {
        Object.entries(context.tags).forEach(([key, value]) => scope.setTag(key, value));
      }
      if (context?.level) {
        scope.setLevel(context.level);
      }
      SentryModule.captureException(error);
    });
  }
}

/**
 * Capture a message.
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'
): void {
  console.log('[Message]', message);

  if (sentryInitialized && SentryModule?.captureMessage) {
    SentryModule.captureMessage(message, level);
  }
}

/**
 * Set user context.
 */
export function setUserContext(user: { id: string; username?: string }): void {
  if (sentryInitialized && SentryModule?.setUser) {
    SentryModule.setUser({ id: user.id, username: user.username });
  }
}

/**
 * Clear user context.
 */
export function clearUserContext(): void {
  if (sentryInitialized && SentryModule?.setUser) {
    SentryModule.setUser(null);
  }
}

/**
 * Add a breadcrumb.
 */
export function addBreadcrumb(
  message: string,
  category: string = 'default',
  data?: Record<string, unknown>
): void {
  if (sentryInitialized && SentryModule?.addBreadcrumb) {
    SentryModule.addBreadcrumb({ message, category, level: 'info', data });
  }
}
