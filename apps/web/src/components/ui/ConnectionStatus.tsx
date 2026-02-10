'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { env } from '@/lib/env';

export function ConnectionStatus() {
  const [status, setStatus] = useState<'online' | 'offline' | 'degraded'>('offline');
  const [isChecking, setIsChecking] = useState(false);

  const fetchWithTimeout = async (url: string, timeoutMs = 8000): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const baseApiUrl = env.apiUrl.replace(/\/$/, '');
      const [liveRes, readyRes] = await Promise.allSettled([
        fetchWithTimeout(`${baseApiUrl}/live`),
        fetchWithTimeout(`${baseApiUrl}/ready`)
      ]);

      const liveOk = liveRes.status === 'fulfilled' && liveRes.value.ok;
      const readyOk = readyRes.status === 'fulfilled' && readyRes.value.ok;

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
