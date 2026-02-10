'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { probeBackendReadiness } from '@/lib/backendHealth'

export function ConnectionStatus() {
  const [status, setStatus] = useState<'online' | 'offline' | 'degraded'>('offline');
  const [isChecking, setIsChecking] = useState(false);

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const { liveOk, readyOk } = await probeBackendReadiness(8000)

      if (liveOk && readyOk) {
        setStatus('online');
      } else if (liveOk) {
        setStatus('degraded');
      } else {
        setStatus('offline');
      }
    } catch {
      setStatus('offline');
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 text-[10px] font-medium">
      {status === 'online' ? (
        <div className="flex items-center gap-1.5 text-green-500/80">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="hidden sm:inline">Backend Online</span>
        </div>
      ) : status === 'degraded' ? (
        <div className="flex items-center gap-2 text-amber-400/90">
          <div className="flex items-center gap-1">
            <AlertTriangle size={12} />
            <span className="hidden sm:inline">Backend Degraded</span>
          </div>
          <button
            onClick={checkConnection}
            disabled={isChecking}
            className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Retry'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-red-500/80">
          <div className="flex items-center gap-1">
            <WifiOff size={12} />
            <span className="hidden sm:inline">Backend Offline</span>
          </div>
          <button
            onClick={checkConnection}
            disabled={isChecking}
            className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
}
