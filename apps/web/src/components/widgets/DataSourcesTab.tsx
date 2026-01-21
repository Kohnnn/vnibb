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
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            <div className="flex items-center justify-between p-4 border-b border-[#1e293b]">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                        <Database size={20} />
                    </div>
                    <div>
                        <h3 className="font-semibold text-white">Data Sources</h3>
                        <p className="text-xs text-gray-500">
                            {dataSources.length} backend{dataSources.length !== 1 ? 's' : ''} configured
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {dataSources.length > 0 && (
                        <button
                            onClick={handleRefreshAll}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                            Refresh All
                        </button>
                    )}
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
                    >
                        <Plus size={16} />
                        Connect Backend
                    </button>
                </div>
            </div>

            {/* VnStock Provider Selection */}
            <div className="p-4 border-b border-[#1e293b]">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                                <Layers size={18} />
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-white">VnStock Provider</h4>
                                <p className="text-xs text-gray-500">Data source for Vietnamese stocks</p>
                            </div>
                        </div>

                        <div className="relative flex-1 max-w-xs">
                            <button
                                onClick={() => setVnstockDropdownOpen(!vnstockDropdownOpen)}
                                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-[#1e293b]/70 border border-[#334155] hover:border-[#475569] rounded-lg text-sm text-white transition-colors"
                            >
                                <span className="font-medium">
                                    {VNSTOCK_SOURCES.find(s => s.value === preferredVnstockSource)?.label}
                                </span>
                                <ChevronDown size={16} className={`text-gray-400 transition-transform ${vnstockDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {vnstockDropdownOpen && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e293b] border border-[#334155] rounded-lg shadow-xl z-20 overflow-hidden">
                                    {VNSTOCK_SOURCES.map((source) => (
                                        <button
                                            key={source.value}
                                            onClick={() => {
                                                setPreferredVnstockSource(source.value);
                                                setVnstockDropdownOpen(false);
                                            }}
                                            className={`w-full flex flex-col items-start px-4 py-3 text-left hover:bg-[#334155] transition-colors ${preferredVnstockSource === source.value ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                                                }`}
                                        >
                                            <span className={`text-sm font-medium ${preferredVnstockSource === source.value ? 'text-blue-400' : 'text-white'}`}>
                                                {source.label}
                                            </span>
                                            <span className="text-xs text-gray-500">{source.description}</span>
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
                        <div className="p-4 bg-[#1e293b]/50 rounded-2xl mb-4">
                            <Server size={48} className="text-gray-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">No Data Sources</h3>
                        <p className="text-gray-500 mb-6 max-w-sm">
                            Connect your backend APIs to fetch real-time data for your widgets.
                        </p>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
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
                                className="group bg-[#1e293b]/50 border border-[#334155] hover:border-[#475569] rounded-xl p-4 transition-all"
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
                                                <h4 className="font-semibold text-white truncate">
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

                                            <div className="flex items-center gap-2 text-sm text-gray-400">
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

                                            <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                                                <Clock size={12} />
                                                Last checked: {formatLastChecked(source.lastChecked)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => checkConnection(source.id)}
                                            className="p-2 text-gray-400 hover:text-white hover:bg-[#334155] rounded-lg transition-colors"
                                            title="Test Connection"
                                        >
                                            <RefreshCw size={16} />
                                        </button>
                                        <button
                                            onClick={() => removeDataSource(source.id)}
                                            className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                            title="Remove"
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
