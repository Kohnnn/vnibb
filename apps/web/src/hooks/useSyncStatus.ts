import { useState, useEffect, useCallback } from 'react';

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
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';
    // Ensure we don't have double slashes if wsUrl ends with /
    const baseWsUrl = wsUrl.replace(/\/$/, '');
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
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const baseApiUrl = API_URL.replace(/\/$/, '');
    
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
