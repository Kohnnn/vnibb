// Peer Comparison Dashboard - Compare multiple stocks side by side with comprehensive metrics
'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';

import {
    Plus,
    X,
    RefreshCw,
    Search,
    LayoutGrid,
    Table as TableIcon,
    LineChart as LineChartIcon,
    Radar,
    Save,
    FolderOpen,
    Trash2,
    Grid3X3
} from 'lucide-react';
import { useComparison, usePeers, usePeerStorage } from '@/hooks/useComparison';
import { ExportButton } from '@/components/common/ExportButton';
import { exportPeers } from '@/lib/api';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import {

    Radar as ReRadar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    CartesianGrid
} from 'recharts';

interface PeerComparisonWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type TabMode = 'table' | 'radar' | 'performance';

interface ComparisonSet {
    id: string;
    name: string;
    symbols: string[];
    createdAt: string;
}

const RADAR_METRICS = [
    { key: 'pe', label: 'P/E (Inv)', inverse: true },
    { key: 'pb', label: 'P/B (Inv)', inverse: true },
    { key: 'roe', label: 'ROE' },
    { key: 'net_margin', label: 'Net Margin' },
    { key: 'revenue_growth', label: 'Growth' },
];

const COMPARISON_SETS_KEY = 'vnibb_saved_comparison_sets';

// Hook for managing saved comparison sets
function useComparisonSets() {
    const [sets, setSetsState] = useState<ComparisonSet[]>([]);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(COMPARISON_SETS_KEY);
            if (stored) setSetsState(JSON.parse(stored));
        } catch (error) {
            console.error('Failed to load comparison sets:', error);
        }
    }, []);


    const setSets = useCallback((newSets: ComparisonSet[]) => {
        setSetsState(newSets);
        if (typeof window !== 'undefined') {
            localStorage.setItem(COMPARISON_SETS_KEY, JSON.stringify(newSets));
        }
    }, []);

    const saveSet = useCallback((name: string, symbols: string[]) => {
        const newSet: ComparisonSet = {
            id: `set_${Date.now()}`,
            name,
            symbols,
            createdAt: new Date().toISOString(),
        };
        setSets([...sets, newSet]);
        return newSet;
    }, [sets, setSets]);

    const deleteSet = useCallback((id: string) => {
        setSets(sets.filter(s => s.id !== id));
    }, [sets, setSets]);

    return { sets, saveSet, deleteSet };
}

export function PeerComparisonWidget({ symbol, isEditing, onRemove }: PeerComparisonWidgetProps) {
    const [peers, setPeers] = usePeerStorage(symbol || 'FPT');
    const [activeTab, setActiveTab] = useState<TabMode>('table');
    const [newPeer, setNewPeer] = useState('');
    const [showSelector, setShowSelector] = useState(false);
    const [showSetsMenu, setShowSetsMenu] = useState(false);
    const [saveSetName, setSaveSetName] = useState('');
    const [period, setPeriod] = useState('1Y');
    const [heatmapEnabled, setHeatmapEnabled] = useState(false);

    const {
        data: compData,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useComparison(peers, period);

    const { data: peerSuggestions } = usePeers(symbol, 5, !!symbol);
    const { sets, saveSet, deleteSet } = useComparisonSets();

    const hasData = Boolean(compData?.metrics?.length);
    const isFallback = Boolean(error && hasData);

    const allMetricValues = useMemo(() => {
        if (!compData?.data) return {};
        const values: Record<string, number[]> = {};
        compData.metrics.forEach(m => {
            values[m.key] = peers.map(sym => compData.data[sym]?.metrics?.[m.key]).filter((v): v is number => typeof v === 'number');
        });
        return values;
    }, [compData, peers]);

    // This is tricky because we need a separate hook result per row, or a more dynamic hook.
    // For simplicity, let's just use the logic directly in the component if we can't call hooks in a loop.
    // Actually we can create a simple helper function since we already have the logic in useHeatmapColors.
    const getHeatmapColor = useMemo(() => {
        return (key: string, value: number) => {
            const vals = allMetricValues[key] || [];
            if (vals.length === 0) return 'transparent';
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const midpoint = vals.reduce((a, b) => a + b, 0) / vals.length;
            
            if (value === midpoint) return 'transparent';
            if (value > midpoint) {
                const range = max - midpoint;
                if (range === 0) return 'rgba(34, 197, 94, 0.1)';
                const intensity = Math.min((value - midpoint) / range, 1);
                return `rgba(34, 197, 94, ${0.1 + intensity * 0.3})`;
            } else {
                const range = midpoint - min;
                if (range === 0) return 'rgba(239, 68, 68, 0.1)';
                const intensity = Math.min((midpoint - value) / range, 1);
                return `rgba(239, 68, 68, ${0.1 + intensity * 0.3})`;
            }
        };
    }, [allMetricValues]);

    const addPeer = (sym: string) => {

        const upper = sym.toUpperCase().trim();
        if (upper && !peers.includes(upper) && peers.length < 6) {
            setPeers([...peers, upper]);
            setNewPeer('');
            setShowSelector(false);
        }
    };

    const removePeer = (sym: string) => {
        if (peers.length > 1) {
            setPeers(peers.filter(p => p !== sym));
        }
    };

    const handleSaveSet = () => {
        if (saveSetName.trim() && peers.length > 0) {
            saveSet(saveSetName.trim(), peers);
            setSaveSetName('');
            setShowSetsMenu(false);
        }
    };

    const handleLoadSet = (set: ComparisonSet) => {
        setPeers(set.symbols);
        setShowSetsMenu(false);
    };

    // Transform data for Radar Chart
    const radarData = useMemo(() => {
        if (!compData?.data) return [];

        return RADAR_METRICS.map(m => {
            const entry: any = { subject: m.label };
            peers.forEach(sym => {
                const val = compData.data[sym]?.metrics?.[m.key];
                // Simple normalization for visualization
                if (m.inverse) {
                    entry[sym] = val ? (1 / val) * 100 : 0;
                } else {
                    entry[sym] = (val || 0) * 100;
                }
            });
            return entry;
        });
    }, [compData, peers]);

    const renderTable = () => {
        if (!compData) return null;
        const sectorAvg = compData.sectorAverages || {};
        
        return (
            <div className="flex-1 overflow-auto">
                <table className="data-table w-full text-[10px] border-collapse">
                    <thead className="text-[var(--text-muted)] sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                        <tr>
                            <th className="text-left py-2 px-2 font-medium bg-[var(--bg-secondary)] z-10 w-32 border-r border-[var(--border-subtle)]">Metric</th>
                            {peers.map((sym, index) => (
                                <th key={`${sym}-${index}`} className="text-right py-2 px-2 font-medium min-w-[80px]">
                                    <div className="flex flex-col">
                                        <span className="text-[var(--text-primary)] font-bold">{sym}</span>
                                        <span className="text-[8px] font-normal truncate opacity-60">
                                            {compData.data[sym]?.name || 'Loading...'}
                                        </span>
                                    </div>
                                </th>
                            ))}
                            <th className="text-right py-2 px-2 font-medium min-w-[70px] text-amber-400/80 border-l border-[var(--border-subtle)]">
                                <div className="flex flex-col">
                                    <span>Sector</span>
                                    <span className="text-[8px] font-normal opacity-60">Avg</span>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                        {compData.metrics.map(metric => {
                            const sectorValue = sectorAvg[metric.key];
                            return (
                                <tr key={metric.key} className="hover:bg-[var(--bg-hover)]">
                                    <td className="py-1.5 px-2 text-[var(--text-secondary)] border-r border-[var(--border-subtle)] sticky left-0 bg-[var(--bg-secondary)]">
                                        {metric.label}
                                    </td>
                                    {peers.map((sym, index) => {
                                        const value = compData.data[sym]?.metrics?.[metric.key];
                                        const isNumeric = typeof value === 'number';

                                        // Highlighting logic (best/worst)
                                        let cellClass = "text-right px-2 font-mono";
                                        let cellStyle = {};
                                        
                                        if (isNumeric) {
                                            if (heatmapEnabled) {
                                                cellStyle = { backgroundColor: getHeatmapColor(metric.key, value) };
                                            } else {
                                                const allValues = peers.map(s => compData.data[s]?.metrics?.[metric.key]).filter(v => typeof v === 'number');
                                                const min = Math.min(...allValues);
                                                const max = Math.max(...allValues);
                                                if (value === max && allValues.length > 1) cellClass += " text-green-400";
                                                else if (value === min && allValues.length > 1) cellClass += " text-red-400";
                                                else cellClass += " text-[var(--text-secondary)]";
                                            }
                                        }

                                        return (
                                            <td key={`${sym}-${index}`} className={cellClass} style={cellStyle}>
                                                {formatCellValue(value, metric.format)}
                                            </td>
                                        );

                                    })}
                                    <td className="text-right px-2 font-mono text-amber-400/60 border-l border-[var(--border-subtle)]">
                                        {sectorValue !== undefined ? formatCellValue(sectorValue, metric.format) : '-'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    // Transform priceHistory for LineChart (flatten values object)
    const chartPriceData = useMemo(() => {
        if (!compData?.priceHistory) return [];
        return compData.priceHistory.map(point => ({
            date: point.date,
            ...point.values
        }));
    }, [compData]);

    const renderCharts = () => (
        <div className="flex-1 flex flex-col gap-4 p-2 overflow-auto">
            {/* Radar Chart for Key Metrics */}
            <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-subtle)] h-[300px]">
                <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                    <Radar size={14} /> Key Metrics Comparison
                </h3>
                <ChartSizeBox className="h-[85%]" minHeight={180}>
                    {({ width, height }) => (
                        <RadarChart width={width} height={height} data={radarData}>
                            <PolarGrid stroke="var(--border-subtle)" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                            {peers.map((sym, i) => (
                                <ReRadar
                                    key={`${sym}-${i}`}
                                    name={sym}
                                    dataKey={sym}
                                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                                    fillOpacity={0.4}
                                />
                            ))}
                            <Legend wrapperStyle={{ fontSize: '10px' }} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    fontSize: '11px',
                                }}
                                itemStyle={{ padding: '2px 0' }}
                            />
                        </RadarChart>
                    )}
                </ChartSizeBox>
            </div>

            {/* Price Performance */}
            <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-subtle)] h-[300px]">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-2">
                        <LineChartIcon size={14} /> Normalized Price Performance (Base 100)
                    </h3>
                    <div className="flex bg-[var(--bg-tertiary)] rounded text-[10px]">
                        {['3M', '6M', '1Y', 'YTD'].map((p, index) => (
                            <button
                                key={`${p}-${index}`}
                                onClick={() => setPeriod(p)}
                                className={`px-2 py-0.5 rounded ${period === p ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
                <ChartSizeBox className="h-[80%]" minHeight={180}>
                    {({ width, height }) => (
                        <LineChart width={width} height={height} data={chartPriceData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.45} />
                            <XAxis
                                dataKey="date"
                                tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                domain={['auto', 'auto']}
                                tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    fontSize: '11px',
                                }}
                            />
                            <Legend wrapperStyle={{ fontSize: '10px' }} />
                            {peers.map((sym, i) => (
                                <Line
                                    key={`${sym}-${i}`}
                                    type="monotone"
                                    dataKey={sym}
                                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                    strokeWidth={2}
                                    dot={false}
                                    name={sym}
                                />
                            ))}
                        </LineChart>
                    )}
                </ChartSizeBox>
            </div>
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] rounded-lg">
            {/* Header Area */}
            <div className="px-3 py-2 border-b border-[var(--border-color)] flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-1 rounded border border-[var(--border-subtle)]">
                        {peers.map((sym, index) => (
                            <div key={`${sym}-${index}`} className="flex items-center gap-1 bg-[var(--bg-tertiary)] px-2 py-0.5 rounded text-[10px] font-medium group">
                                {sym}
                                {peers.length > 2 && (
                                    <button onClick={() => removePeer(sym)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {peers.length < 6 && (
                            <button
                                onClick={() => setShowSelector(!showSelector)}
                                className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                                <Plus size={12} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={`Period ${period}`}
                        align="right"
                    />
                    {/* Saved Sets Menu */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSetsMenu(!showSetsMenu)}
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded border border-[var(--border-subtle)]"
                            title="Saved Comparisons"
                        >
                            <FolderOpen size={14} />
                        </button>
                        {showSetsMenu && (
                            <div className="absolute top-8 right-0 z-50 w-56 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl p-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="mb-2 pb-2 border-b border-[var(--border-subtle)]">
                                    <div className="flex gap-1">
                                        <input
                                            type="text"
                                            value={saveSetName}
                                            onChange={(e) => setSaveSetName(e.target.value)}
                                            placeholder="Save current as..."
                                            className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                        <button
                                            onClick={handleSaveSet}
                                            disabled={!saveSetName.trim()}
                                            className="p-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
                                        >
                                            <Save size={12} />
                                        </button>
                                    </div>
                                </div>
                                {sets.length === 0 ? (
                                    <p className="text-[10px] text-[var(--text-muted)] text-center py-2">No saved sets</p>
                                ) : (
                                    <div className="space-y-1 max-h-40 overflow-auto">
                                        {sets.map(set => (
                                            <div
                                                key={set.id}
                                                className="flex items-center justify-between px-2 py-1.5 hover:bg-[var(--bg-hover)] rounded text-[10px] group"
                                            >
                                                <button
                                                    onClick={() => handleLoadSet(set)}
                                                    className="flex-1 text-left"
                                                >
                                                    <span className="font-medium text-[var(--text-primary)]">{set.name}</span>
                                                    <span className="text-[var(--text-muted)] ml-1">({set.symbols.length})</span>
                                                </button>
                                                <button
                                                    onClick={() => deleteSet(set.id)}
                                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                                                >
                                                    <Trash2 size={10} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-subtle)]">
                        <button
                            onClick={() => setActiveTab('table')}
                            className={`p-1.5 rounded transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                        >
                            <TableIcon size={14} />
                        </button>
                        <button
                            onClick={() => setActiveTab('radar')}
                            className={`p-1.5 rounded transition-all ${activeTab === 'radar' ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                        >
                            <LayoutGrid size={14} />
                        </button>
                    </div>

                    <button
                        onClick={() => setHeatmapEnabled(!heatmapEnabled)}
                        className={`p-1.5 rounded transition-all border border-[var(--border-subtle)] ${heatmapEnabled ? 'bg-blue-600/20 text-blue-400 border-blue-500/50' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)]'}`}
                        title="Toggle Heatmap"
                    >
                        <Grid3X3 size={14} />
                    </button>

                    <button onClick={() => refetch()} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded border border-[var(--border-subtle)]">

                        <RefreshCw size={14} />
                    </button>
                    <ExportButton onExport={async (f) => exportPeers(peers, { format: f })} variant="ghost" className="h-8 w-8 p-0" />
                </div>
            </div>

            {/* Peer Selector Panel */}
            {showSelector && (
                <div className="absolute top-12 left-3 z-50 w-64 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl p-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="relative mb-3">
                        <Search size={14} className="absolute left-2 top-2 text-[var(--text-muted)]" />
                        <input
                            type="text"
                            value={newPeer}
                            onChange={(e) => setNewPeer(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addPeer(newPeer)}
                            placeholder="Enter ticker..."
                            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded pl-8 pr-2 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:ring-1 focus:ring-blue-500 outline-none"
                            autoFocus
                        />
                    </div>
                    {peerSuggestions?.peers && (
                        <div>
                            <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold tracking-wider mb-2 block">Suggestions</span>
                            <div className="space-y-1">
                                {peerSuggestions.peers.map((p, index) => (
                                    <button
                                        key={`${p.symbol}-${index}`}
                                        onClick={() => addPeer(p.symbol)}
                                        className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-[var(--bg-hover)] rounded text-xs transition-colors group"
                                    >
                                        <span className="font-bold">{p.symbol}</span>
                                        <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">{p.name || ''}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0">
                {peers.length === 0 ? (
                    <WidgetEmpty message="Add peers to compare" />
                ) : isLoading && !hasData ? (
                    <WidgetSkeleton variant="table" lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No comparison data available" />
                ) : activeTab === 'table' ? renderTable() : renderCharts()}
            </div>
        </div>
    );
}

// Helper: Format cell values based on metric format type
function formatCellValue(value: any, format: string) {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value !== 'number') return String(value);

    switch (format) {
        case 'currency':
            if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
            return value.toLocaleString();
        case 'percent':
            return `${(value * 100).toFixed(1)}%`;
        case 'large_number':
            if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
            if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
            if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
            return value.toLocaleString();
        case 'ratio':
            return value.toFixed(2);
        default:
            return value.toLocaleString();
    }
}

const CHART_COLORS = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#06B6D4', // Cyan
    '#EC4899', // Pink
];
