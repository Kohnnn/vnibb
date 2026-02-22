// Data Sources Tab - Display and manage connected backends

'use client';

import { useState, useEffect } from 'react';
import { useDataSources } from '@/contexts/DataSourcesContext';
import { ConnectBackendModal } from './ConnectBackendModal';
import {
    Database,
    Plus,
    Trash2,
    RefreshCw,
    ExternalLink,
    Server,
    Clock,
    ChevronDown,
    Layers,
} from 'lucide-react';
import type { VnstockSource } from '@/contexts/DataSourcesContext';

const VNSTOCK_SOURCES: { value: VnstockSource; label: string; description: string }[] = [
    { value: 'KBS', label: 'KBS (Korea)', description: '✨ Recommended - New default in vnstock 3.4.0' },
    { value: 'VCI', label: 'VCI (Vietcap)', description: 'Most stable, comprehensive coverage' },
    { value: 'TCBS', label: 'TCBS', description: 'Premium features (may have upstream issues)' },
    { value: 'DNSE', label: 'DNSE', description: 'Good historical data, minute-level resolution' },
];

export function DataSourcesTab() {
    const { dataSources, addDataSource, removeDataSource, checkConnection, checkAllConnections, preferredVnstockSource, setPreferredVnstockSource } = useDataSources();
    const [vnstockDropdownOpen, setVnstockDropdownOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Check all connections on mount
    useEffect(() => {
        if (dataSources.length > 0) {
            checkAllConnections();
        }
    }, []);

    const handleConnect = (endpoint: string, name?: string) => {
        const newSource = addDataSource({ endpoint, name });
        // Check connection immediately after adding
        checkConnection(newSource.id);
    };

    const handleRefreshAll = async () => {
        setRefreshing(true);
        await checkAllConnections();
        setRefreshing(false);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'connected':
                return 'bg-green-500';
            case 'checking':
                return 'bg-yellow-500 animate-pulse';
            case 'error':
            case 'disconnected':
            default:
                return 'bg-red-500';
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'connected':
                return 'Connected';
            case 'checking':
                return 'Checking...';
            case 'error':
                return 'Error';
            case 'disconnected':
            default:
                return 'Disconnected';
        }
    };

    const formatLastChecked = (lastChecked?: string) => {
        if (!lastChecked) return 'Never';
        const date = new Date(lastChecked);
        return date.toLocaleTimeString();
    };

    return (
        <div className="flex-1 flex flex-col">
            {/* Header Bar */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
                        <Database size={20} />
                    </div>
                    <div>
                        <h3 className="font-semibold text-[var(--text-primary)]">Data Sources</h3>
                        <p className="text-xs text-[var(--text-muted)]">
                            {dataSources.length} backend{dataSources.length !== 1 ? 's' : ''} configured
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {dataSources.length > 0 && (
                        <button
                            onClick={handleRefreshAll}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRefreshAll();
                                }
                            }}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors disabled:opacity-50"
                            aria-label="Refresh all connections"
                        >
                            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                            Refresh All
                        </button>
                    )}
                    <button
                        onClick={() => setIsModalOpen(true)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setIsModalOpen(true);
                            }
                        }}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
                        aria-label="Connect backend"
                    >
                        <Plus size={16} />
                        Connect Backend
                    </button>
                </div>
            </div>

            {/* VnStock Provider Selection */}
            <div className="p-4 border-b border-[var(--border-color)]">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                                <Layers size={18} />
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-[var(--text-primary)]">VnStock Provider</h4>
                                <p className="text-xs text-[var(--text-muted)]">Data source for Vietnamese stocks</p>
                            </div>
                        </div>

                        <div className="relative flex-1 max-w-xs">
                            <button
                                onClick={() => setVnstockDropdownOpen(!vnstockDropdownOpen)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setVnstockDropdownOpen(!vnstockDropdownOpen);
                                    }
                                }}
                                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] transition-colors"
                                aria-label="Select VnStock provider"
                            >
                                <span className="font-medium">
                                    {VNSTOCK_SOURCES.find(s => s.value === preferredVnstockSource)?.label}
                                </span>
                                <ChevronDown size={16} className={`text-[var(--text-muted)] transition-transform ${vnstockDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {vnstockDropdownOpen && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-dropdown)] border border-[var(--border-default)] rounded-lg shadow-xl z-20 overflow-hidden">
                                    {VNSTOCK_SOURCES.map((source) => (
                                        <button
                                            key={source.value}
                                            onClick={() => {
                                                setPreferredVnstockSource(source.value);
                                                setVnstockDropdownOpen(false);
                                            }}
                                            className={`w-full flex flex-col items-start px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors ${preferredVnstockSource === source.value ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                                                }`}
                                        >
                                            <span className={`text-sm font-medium ${preferredVnstockSource === source.value ? 'text-blue-400' : 'text-[var(--text-primary)]'}`}>
                                                {source.label}
                                            </span>
                                            <span className="text-xs text-[var(--text-muted)]">{source.description}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {dataSources.length === 0 ? (
                    // Empty State
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <div className="p-4 bg-[var(--bg-secondary)]/60 rounded-2xl mb-4">
                            <Server size={48} className="text-[var(--text-muted)]" />
                        </div>
                        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">No Data Sources</h3>
                        <p className="text-[var(--text-muted)] mb-6 max-w-sm">
                            Connect your backend APIs to fetch real-time data for your widgets.
                        </p>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsModalOpen(true);
                                }
                            }}
                            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
                            aria-label="Connect your first backend"
                        >
                            <Plus size={18} />
                            Connect Your First Backend
                        </button>
                    </div>
                ) : (
                    // Data Sources List
                    <div className="space-y-3 max-w-3xl mx-auto">
                        {dataSources.map((source) => (
                            <div
                                key={source.id}
                                className="group bg-[var(--bg-secondary)]/70 border border-[var(--border-default)] hover:border-[var(--border-color)] rounded-xl p-4 transition-all"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4">
                                        {/* Status Indicator */}
                                        <div className="pt-1">
                                            <div
                                                className={`w-3 h-3 rounded-full ${getStatusColor(source.status)}`}
                                                title={getStatusText(source.status)}
                                            />
                                        </div>

                                        {/* Info */}
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h4 className="font-semibold text-[var(--text-primary)] truncate">
                                                    {source.name}
                                                </h4>
                                                <span className={`text-xs px-2 py-0.5 rounded ${source.status === 'connected'
                                                    ? 'bg-green-500/10 text-green-400'
                                                    : source.status === 'checking'
                                                        ? 'bg-yellow-500/10 text-yellow-400'
                                                        : 'bg-red-500/10 text-red-400'
                                                    }`}>
                                                    {getStatusText(source.status)}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                                                <ExternalLink size={14} />
                                                <span className="font-mono text-xs truncate max-w-md">
                                                    {source.endpoint}
                                                </span>
                                            </div>

                                            {source.errorMessage && (
                                                <p className="mt-1 text-xs text-red-400">
                                                    {source.errorMessage}
                                                </p>
                                            )}

                                            <div className="flex items-center gap-1 mt-2 text-xs text-[var(--text-muted)]">
                                                <Clock size={12} />
                                                Last checked: {formatLastChecked(source.lastChecked)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => checkConnection(source.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    checkConnection(source.id);
                                                }
                                            }}
                                            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                                            title="Test Connection"
                                            aria-label={`Test connection for ${source.name}`}
                                        >
                                            <RefreshCw size={16} />
                                        </button>
                                        <button
                                            onClick={() => removeDataSource(source.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    removeDataSource(source.id);
                                                }
                                            }}
                                            className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                            title="Remove"
                                            aria-label={`Remove ${source.name}`}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal */}
            <ConnectBackendModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConnect={handleConnect}
            />
        </div>
    );
}
