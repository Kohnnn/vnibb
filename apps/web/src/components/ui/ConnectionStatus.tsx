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
        <div className="flex items-center gap-1.5 text-emerald-500/80">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="hidden sm:inline">Status: Online</span>
        </div>
      ) : status === 'degraded' ? (
        <div className="flex items-center gap-2 text-amber-400/90">
          <div className="flex items-center gap-1">
            <AlertTriangle size={12} />
            <span className="hidden sm:inline">Status: Degraded</span>
          </div>
          <button
            onClick={() => checkConnection()}
            disabled={isChecking}
            className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/25 rounded text-amber-200/90 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Retry'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-amber-300/90">
          <div className="flex items-center gap-1">
            <WifiOff size={12} className="opacity-80" />
            <span className="hidden sm:inline">Status: Degraded</span>
          </div>
          <button
            onClick={() => checkConnection()}
            disabled={isChecking}
            className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/25 rounded text-amber-200/90 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
}
