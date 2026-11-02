'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface RateLimitAlertProps {
  retryAfter: number; // seconds
  onRetry: () => void;
  onDismiss?: () => void;
}

export function RateLimitAlert({ retryAfter, onRetry, onDismiss }: RateLimitAlertProps) {
  const [remaining, setRemaining] = useState(retryAfter);

  useEffect(() => {
    if (remaining <= 0) {
      onRetry();
      return;
    }
    const timer = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onRetry]);

  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--color-state-border)] bg-[var(--color-state-bg)] p-3">
      <Clock className="h-5 w-5 animate-pulse text-[var(--color-warning)]" />
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--color-warning)]">Rate Limited</p>
        <p className="text-xs text-[var(--text-secondary)]">
          Auto-retry in {remaining}s
        </p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
          ✕
        </button>
      )}
    </div>
  );
}
