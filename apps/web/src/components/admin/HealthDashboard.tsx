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
      // Use the new env helper
      const { env } = await import('@/lib/env');
      const res = await fetch(`${env.apiUrl}/health/detailed`);
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

  const statusColor = health?.status === 'healthy' ? 'green' : health?.status === 'degraded' ? 'yellow' : 'red';

  return (
    <div className="p-6 bg-gray-900 rounded-lg border border-gray-800">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">System Health</h2>
        </div>
        <button 
          onClick={fetchHealth} 
          disabled={loading}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-5 h-5 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
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
          <div className={`flex items-center gap-3 p-4 rounded-lg bg-${statusColor}-500/10 border border-${statusColor}-500/30`}>
            <StatusIcon status={health.status} />
            <div>
              <span className="text-white font-medium capitalize">{health.status}</span>
              <span className="text-gray-500 ml-2">v{health.version}</span>
            </div>
            <span className="ml-auto text-gray-500 text-sm">{health.environment}</span>
          </div>
          
          {/* Components Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(health.components).map(([name, data]) => (
              <div key={name} className="p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <StatusIcon status={data.status} />
                  <span className="text-gray-200 font-medium capitalize">{name}</span>
                </div>
                <div className="space-y-1">
                  {Object.entries(data).filter(([k]) => k !== 'status').map(([key, value]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="text-gray-300">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* Last Updated */}
          <p className="text-gray-600 text-xs text-right">
            Last updated: {new Date(health.timestamp).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}
