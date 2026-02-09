import { useState, useEffect, useCallback } from 'react';
import { config } from '@/lib/config';

interface SyncStatus {
  isRunning: boolean;
  currentTask: string | null;
  progress: number;
  lastSync: string | null;
  error: string | null;
}

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({
    isRunning: false,
    currentTask: null,
    progress: 0,
    lastSync: null,
    error: null,
  });
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!config.enableRealtime || config.isDev) return;

    const baseWsUrl = config.wsBaseUrl.replace(/\/$/, '');
    const ws = new WebSocket(`${baseWsUrl}/api/v1/data/sync/ws/status`);

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setStatus(prev => ({
          ...prev,
          ...data,
        }));
      } catch (e) {
        console.error('Failed to parse sync status:', e);
      }
    };

    return () => ws.close();
  }, []);

  const triggerSync = useCallback(async (type: 'screener' | 'prices' | 'full') => {
    const baseApiUrl = config.apiBaseUrl;

    const response = await fetch(`${baseApiUrl}/api/v1/data/sync/${type}`, {
      method: 'POST',
    });
    
    if (!response.ok) {
      throw new Error(`Failed to trigger sync: ${response.statusText}`);
    }
    
    return response.json();
  }, []);

  return {
    status,
    isConnected,
    triggerSync,
  };
}
