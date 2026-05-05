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
    <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
      <Clock className="w-5 h-5 text-amber-400 animate-pulse" />
      <div className="flex-1">
        <p className="text-amber-400 text-sm font-medium">Rate Limited</p>
        <p className="text-amber-400/70 text-xs">
          Auto-retry in {remaining}s
        </p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-amber-400/50 hover:text-amber-400 transition-colors">
          ✕
        </button>
      )}
    </div>
  );
}
