'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle, WifiOff, Loader2 } from 'lucide-react';
import { probeBackendReadiness } from '@/lib/backendHealth'

type ConnectionState = 'checking' | 'online' | 'offline' | 'degraded';

export function ConnectionStatus() {
  const [status, setStatus] = useState<ConnectionState>('checking');
  const [isChecking, setIsChecking] = useState(false);
  const consecutiveFailuresRef = useRef(0);
  const OFFLINE_THRESHOLD = 3;

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const { healthOk, dataOk } = await probeBackendReadiness(8000);

      if (healthOk && dataOk) {
        consecutiveFailuresRef.current = 0;
        setStatus('online');
      } else if (healthOk) {
        consecutiveFailuresRef.current = 0;
        setStatus('degraded');
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= OFFLINE_THRESHOLD) {
          setStatus('offline');
        } else if (status === 'checking') {
          setStatus('degraded');
        }
      }
    } catch {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= OFFLINE_THRESHOLD) {
        setStatus('offline');
      } else if (status === 'checking') {
        setStatus('degraded');
      }
    } finally {
      setIsChecking(false);
    }
  }, [status]);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(() => checkConnection(), 60000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  return (
    <div className="flex items-center gap-3 text-[10px] font-medium">
      {status === 'checking' ? (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 size={10} className="animate-spin" />
          <span className="hidden sm:inline">Status: Checking</span>
        </div>
      ) : status === 'online' ? (
        <div className="flex items-center gap-1.5 text-[var(--color-success)]">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
          <span className="hidden sm:inline">Status: Online</span>
        </div>
      ) : status === 'degraded' ? (
        <div className="flex items-center gap-2 text-[var(--color-warning)]">
          <div className="flex items-center gap-1">
            <AlertTriangle size={12} />
            <span className="hidden sm:inline">Status: Degraded</span>
          </div>
          <button
            onClick={() => checkConnection()}
            disabled={isChecking}
            className="px-2 py-0.5 bg-[var(--color-state-bg)] border border-[var(--color-state-border)] rounded text-[var(--color-warning)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Retry'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[var(--color-warning)]">
          <div className="flex items-center gap-1">
            <WifiOff size={12} className="opacity-80" />
            <span className="hidden sm:inline">Status: Degraded</span>
          </div>
          <button
            onClick={() => checkConnection()}
            disabled={isChecking}
            className="px-2 py-0.5 bg-[var(--color-state-bg)] border border-[var(--color-state-border)] rounded text-[var(--color-warning)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
}
