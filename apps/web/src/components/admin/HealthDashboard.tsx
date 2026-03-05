'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Database, Server } from 'lucide-react';

interface HealthData {
  status: string;
  version: string;
  environment: string;
  timestamp: string;
  components: Record<string, { status: string; [key: string]: unknown }>;
}

export function HealthDashboard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const { env } = await import('@/lib/env');
      const { getRuntimeApiBaseUrl } = await import('@/lib/backendHealth');
      const baseUrl = getRuntimeApiBaseUrl(env.apiUrl);
      if (!baseUrl) {
        throw new Error('API base URL unavailable');
      }

      const res = await fetch(`${baseUrl}/health/detailed`);
      if (!res.ok) throw new Error('Health check failed');
      setHealth(await res.json());
      setError(null);
    } catch (e) {
      setError('Failed to fetch health status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchHealth(); 
    const interval = setInterval(fetchHealth, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'healthy') return <CheckCircle className="w-5 h-5 text-green-400" />;
    if (status === 'unhealthy') return <XCircle className="w-5 h-5 text-red-400" />;
    return <AlertCircle className="w-5 h-5 text-yellow-400" />;
  };

  const statusClass =
    health?.status === 'healthy'
      ? 'bg-green-500/10 border-green-500/30'
      : health?.status === 'degraded'
        ? 'bg-yellow-500/10 border-yellow-500/30'
        : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-[var(--text-primary)]">System Health</h2>
        </div>
        <button 
          onClick={fetchHealth} 
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fetchHealth();
            }
          }}
          disabled={loading}
          className="rounded-lg p-2 transition-colors hover:bg-[var(--bg-tertiary)]"
          aria-label="Refresh health status"
        >
          <RefreshCw className={`h-5 w-5 text-[var(--text-secondary)] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      
      {health && (
        <div className="space-y-4">
          {/* Overall Status */}
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${statusClass}`}>
            <StatusIcon status={health.status} />
            <div>
              <span className="font-medium capitalize text-[var(--text-primary)]">{health.status}</span>
              <span className="ml-2 text-[var(--text-muted)]">v{health.version}</span>
            </div>
            <span className="ml-auto text-sm text-[var(--text-muted)]">{health.environment}</span>
          </div>
          
          {/* Components Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(health.components).map(([name, data]) => (
              <div key={name} className="rounded-lg bg-[var(--bg-tertiary)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <StatusIcon status={data.status} />
                  <span className="font-medium capitalize text-[var(--text-primary)]">{name}</span>
                </div>
                <div className="space-y-1">
                  {Object.entries(data).filter(([k]) => k !== 'status').map(([key, value]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="capitalize text-[var(--text-muted)]">{key.replace(/_/g, ' ')}</span>
                      <span className="text-[var(--text-secondary)]">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* Last Updated */}
          <p className="text-right text-xs text-[var(--text-muted)]">
            Last updated: {new Date(health.timestamp).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}
