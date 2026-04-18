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
    Grid3X3,
    ArrowUpDown
} from 'lucide-react';
import { useComparison, usePeers } from '@/hooks/useComparison';
import { ExportButton } from '@/components/common/ExportButton';
import { exportPeers } from '@/lib/api';
import { EMPTY_VALUE, formatCompactValueForUnit, formatNumber, formatPercent, type UnitConfig } from '@/lib/units';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { useDashboard } from '@/contexts/DashboardContext';
import { useUnit } from '@/contexts/UnitContext';
import { logClientError } from '@/lib/clientLogger';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
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
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
}

type TabMode = 'table' | 'radar' | 'performance';
type SortDirection = 'asc' | 'desc';

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

function hasOwnConfigKey(config: Record<string, unknown> | undefined, key: string): boolean {
    return Boolean(config) && Object.prototype.hasOwnProperty.call(config, key);
}

function parseLegacyComparisonSets(): ComparisonSet[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(COMPARISON_SETS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        logClientError('Failed to load comparison sets:', error);
        return [];
    }
}

function parseComparisonSets(config: Record<string, unknown> | undefined): ComparisonSet[] {
    const rawValue = config?.savedComparisonSets;
    if (!Array.isArray(rawValue)) {
        return hasOwnConfigKey(config, 'savedComparisonSets') ? [] : parseLegacyComparisonSets();
    }

    return rawValue.filter((item): item is ComparisonSet => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<ComparisonSet>;
        return typeof candidate.id === 'string'
            && typeof candidate.name === 'string'
            && Array.isArray(candidate.symbols)
            && typeof candidate.createdAt === 'string';
    });
}

function parseComparisonPeers(config: Record<string, unknown> | undefined, initialSymbol: string): string[] {
    const rawValue = config?.comparisonPeers;
    if (Array.isArray(rawValue)) {
        const parsed = rawValue
            .filter((item): item is string => typeof item === 'string' && Boolean(item))
            .map((item) => item.toUpperCase().trim());
        if (parsed.length > 0) {
            return Array.from(new Set(parsed)).slice(0, 6);
        }
        return [];
    }

    return Array.from(new Set([initialSymbol, 'VNM', 'VIC'].filter(Boolean))).slice(0, 3);
}

function parseComparisonViewMode(config: Record<string, unknown> | undefined): TabMode {
    const rawValue = config?.comparisonViewMode;
    return rawValue === 'radar' || rawValue === 'performance' ? rawValue : 'table';
}

function parseComparisonPeriod(config: Record<string, unknown> | undefined): string {
    return typeof config?.comparisonPeriod === 'string' && config.comparisonPeriod.trim()
        ? config.comparisonPeriod
        : '1Y';
}

function parseHeatmapPreference(config: Record<string, unknown> | undefined): boolean {
    return config?.comparisonHeatmapEnabled === true;
}

function parseSortKey(config: Record<string, unknown> | undefined): string {
    return typeof config?.comparisonSortKey === 'string' && config.comparisonSortKey.trim()
        ? config.comparisonSortKey
        : 'metric';
}

function parseSortDirection(config: Record<string, unknown> | undefined): SortDirection {
    return config?.comparisonSortDirection === 'desc' ? 'desc' : 'asc';
}

export function PeerComparisonWidget({ id, symbol, config, isEditing, onRemove }: PeerComparisonWidgetProps) {
    const { updateWidget } = useDashboard();
    const { config: unitConfig } = useUnit();
    const widgetLocation = useDashboardWidget(id);
    const persistedPeers = useMemo(() => parseComparisonPeers(config, symbol || 'FPT'), [config, symbol]);
    const persistedSets = useMemo(() => parseComparisonSets(config), [config]);
    const persistedViewMode = useMemo(() => parseComparisonViewMode(config), [config]);
    const persistedPeriod = useMemo(() => parseComparisonPeriod(config), [config]);
    const persistedHeatmapEnabled = useMemo(() => parseHeatmapPreference(config), [config]);
    const persistedSortKey = useMemo(() => parseSortKey(config), [config]);
    const persistedSortDirection = useMemo(() => parseSortDirection(config), [config]);

    const [peers, setPeers] = useState<string[]>(persistedPeers);
    const [activeTab, setActiveTab] = useState<TabMode>(persistedViewMode);
    const [newPeer, setNewPeer] = useState('');
    const [showSelector, setShowSelector] = useState(false);
    const [showSetsMenu, setShowSetsMenu] = useState(false);
    const [saveSetName, setSaveSetName] = useState('');
    const [period, setPeriod] = useState(persistedPeriod);
    const [heatmapEnabled, setHeatmapEnabled] = useState(persistedHeatmapEnabled);
    const [sortKey, setSortKey] = useState<string>(persistedSortKey);
    const [sortDirection, setSortDirection] = useState<SortDirection>(persistedSortDirection);
    const [sets, setSets] = useState<ComparisonSet[]>(persistedSets);

    useEffect(() => {
        setPeers((current) => JSON.stringify(current) === JSON.stringify(persistedPeers) ? current : persistedPeers);
    }, [persistedPeers]);

    useEffect(() => {
        setSets((current) => JSON.stringify(current) === JSON.stringify(persistedSets) ? current : persistedSets);
    }, [persistedSets]);

    useEffect(() => {
        setActiveTab((current) => current === persistedViewMode ? current : persistedViewMode);
    }, [persistedViewMode]);

    useEffect(() => {
        setPeriod((current) => current === persistedPeriod ? current : persistedPeriod);
    }, [persistedPeriod]);

    useEffect(() => {
        setHeatmapEnabled((current) => current === persistedHeatmapEnabled ? current : persistedHeatmapEnabled);
    }, [persistedHeatmapEnabled]);

    useEffect(() => {
        setSortKey((current) => current === persistedSortKey ? current : persistedSortKey);
    }, [persistedSortKey]);

    useEffect(() => {
        setSortDirection((current) => current === persistedSortDirection ? current : persistedSortDirection);
    }, [persistedSortDirection]);

    useEffect(() => {
        if (!widgetLocation) {
            return;
        }

        const currentConfig = widgetLocation.widget.config || {};
        if (
            JSON.stringify(currentConfig.comparisonPeers ?? []) === JSON.stringify(peers)
            && JSON.stringify(currentConfig.savedComparisonSets ?? []) === JSON.stringify(sets)
            && currentConfig.comparisonViewMode === activeTab
            && currentConfig.comparisonPeriod === period
            && currentConfig.comparisonHeatmapEnabled === heatmapEnabled
            && currentConfig.comparisonSortKey === sortKey
            && currentConfig.comparisonSortDirection === sortDirection
        ) {
            return;
        }

        updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
            config: {
                ...currentConfig,
                comparisonPeers: peers,
                savedComparisonSets: sets,
                comparisonViewMode: activeTab,
                comparisonPeriod: period,
                comparisonHeatmapEnabled: heatmapEnabled,
                comparisonSortKey: sortKey,
                comparisonSortDirection: sortDirection,
            },
        });
    }, [activeTab, heatmapEnabled, id, peers, period, sets, sortDirection, sortKey, updateWidget, widgetLocation]);

    const {
        data: compData,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useComparison(peers, { period });

    const { data: peerSuggestions } = usePeers(symbol, 5, !!symbol);
    const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'peer_comparison' });

    const comparisonData = useMemo(() => {
        if (!compData?.stocks) return {} as Record<string, { name: string; metrics: Record<string, number | null> }>;
        return compData.stocks.reduce<Record<string, { name: string; metrics: Record<string, number | null> }>>((acc, stock) => {
            acc[stock.symbol] = {
                name: stock.company_name || stock.name || stock.symbol,
                metrics: stock.metrics || {},
            };
            return acc;
        }, {});
    }, [compData?.stocks]);

    const normalizedMetrics = useMemo<Array<{ key: string; label: string; format: string }>>(() => {
        return (compData?.metrics || []).map((metric) => ({
            ...metric,
            key: metric.id || metric.key || '',
            label: metric.name || metric.label || metric.id || metric.key || 'Metric',
            format: metric.format || 'number',
        }));
    }, [compData?.metrics]);

    const { sectorAverages, sectorAverageCounts } = useMemo(() => {
        const accumulator: Record<string, number[]> = {};
        Object.values(comparisonData).forEach((stock) => {
            Object.entries(stock.metrics || {}).forEach(([key, value]) => {
                if (typeof value !== 'number' || !Number.isFinite(value)) return;
                if (!accumulator[key]) accumulator[key] = [];
                accumulator[key].push(value);
            });
        });

        return {
            sectorAverages: Object.fromEntries(
                Object.entries(accumulator).map(([key, values]) => [
                    key,
                    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
                ])
            ),
            sectorAverageCounts: Object.fromEntries(
                Object.entries(accumulator).map(([key, values]) => [key, values.length])
            ),
        };
    }, [comparisonData]);

    const hasData = Boolean(normalizedMetrics.length);
    const isFallback = Boolean(error && hasData);

    const allMetricValues = useMemo(() => {
        if (!Object.keys(comparisonData).length) return {};
        const values: Record<string, number[]> = {};
        normalizedMetrics.forEach(m => {
            values[m.key] = peers.map(sym => comparisonData[sym]?.metrics?.[m.key]).filter((v): v is number => typeof v === 'number');
        });
        return values;
    }, [comparisonData, normalizedMetrics, peers]);

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
            const newSet: ComparisonSet = {
                id: `set_${Date.now()}`,
                name: saveSetName.trim(),
                symbols: peers,
                createdAt: new Date().toISOString(),
            };
            setSets((current) => [...current, newSet]);
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
        if (!Object.keys(comparisonData).length) return [];

        return RADAR_METRICS.map(m => {
            const entry: any = { subject: m.label };
            peers.forEach(sym => {
                const val = comparisonData[sym]?.metrics?.[m.key];
                // Simple normalization for visualization
                if (m.inverse) {
                    entry[sym] = val ? (1 / val) * 100 : 0;
                } else {
                    entry[sym] = (val || 0) * 100;
                }
            });
            return entry;
        });
    }, [comparisonData, peers]);

    const sortedMetrics = useMemo(() => {
        if (!normalizedMetrics.length) return [];

        const metrics = [...normalizedMetrics];
        const getSortValue = (metric: typeof normalizedMetrics[number]) => {
            if (sortKey === 'metric') return metric.label;
            if (sortKey === 'sector') return sectorAverages?.[metric.key] ?? null;
            return comparisonData?.[sortKey]?.metrics?.[metric.key] ?? null;
        };

        metrics.sort((left, right) => {
            const leftValue = getSortValue(left);
            const rightValue = getSortValue(right);

            if (typeof leftValue === 'string' || typeof rightValue === 'string') {
                const leftText = String(leftValue ?? '');
                const rightText = String(rightValue ?? '');
                return sortDirection === 'asc'
                    ? leftText.localeCompare(rightText)
                    : rightText.localeCompare(leftText);
            }

            const leftNumber = typeof leftValue === 'number' ? leftValue : Number.NEGATIVE_INFINITY;
            const rightNumber = typeof rightValue === 'number' ? rightValue : Number.NEGATIVE_INFINITY;
            return sortDirection === 'asc' ? leftNumber - rightNumber : rightNumber - leftNumber;
        });

        return metrics;
    }, [comparisonData, normalizedMetrics, sectorAverages, sortDirection, sortKey]);

    const handleSort = (nextKey: string) => {
        if (sortKey === nextKey) {
            setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
            return;
        }

        setSortKey(nextKey);
        setSortDirection(nextKey === 'metric' ? 'asc' : 'desc');
    };

    const sortIndicator = (key: string) => {
        if (sortKey !== key) return <ArrowUpDown size={10} className="opacity-50" />;
        return <span className="text-[10px]">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
    };

    const renderTable = () => {
        if (!compData) return null;
        const sectorAvg = sectorAverages || {};
        
        return (
            <div className="flex-1 overflow-auto">
                        <table className="data-table w-full text-[10px] border-collapse">
                    <thead className="text-[var(--text-muted)] sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                        <tr>
                            <th className="text-left py-2 px-2 font-medium bg-[var(--bg-secondary)] z-10 min-w-[148px] border-r border-[var(--border-subtle)]">
                                <button type="button" onClick={() => handleSort('metric')} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                                    <span>Metric</span>
                                    {sortIndicator('metric')}
                                </button>
                            </th>
                            {peers.map((sym, index) => (
                                <th key={`${sym}-${index}`} className="text-right py-2 px-2 font-medium min-w-[104px]">
                                    <div className="flex flex-col">
                                        <button type="button" onClick={() => handleSort(sym)} className="inline-flex items-center justify-end gap-1 font-bold text-[var(--text-primary)] hover:text-blue-300">
                                            <span>{sym}</span>
                                            {sortIndicator(sym)}
                                        </button>
                                        <span className="text-[8px] font-normal break-words opacity-60">
                                            {comparisonData[sym]?.name || 'Loading...'}
                                        </span>
                                    </div>
                                </th>
                            ))}
                            <th className="text-right py-2 px-2 font-medium min-w-[84px] text-amber-400/80 border-l border-[var(--border-subtle)]">
                                <div className="flex flex-col">
                                    <button type="button" onClick={() => handleSort('sector')} className="inline-flex items-center justify-end gap-1 hover:text-amber-300">
                                    <span>Sector Avg</span>
                                        {sortIndicator('sector')}
                                    </button>
                                    <span className="text-[8px] font-normal opacity-60">Excludes N/A</span>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                        {sortedMetrics.map(metric => {
                            const sectorValue = sectorAvg[metric.key];
                            return (
                                <tr key={metric.key} className="hover:bg-[var(--bg-hover)]">
                                    <td className="py-1.5 px-2 text-[var(--text-secondary)] border-r border-[var(--border-subtle)] sticky left-0 bg-[var(--bg-secondary)] min-w-[148px]">
                                        {metric.label}
                                    </td>
                                    {peers.map((sym, index) => {
                                        const value = comparisonData[sym]?.metrics?.[metric.key];
                                        const isNumeric = typeof value === 'number';

                                        // Highlighting logic (best/worst)
                                        let cellClass = "text-right px-2 font-mono";
                                        let cellStyle = {};
                                        
                                        if (isNumeric) {
                                            if (heatmapEnabled) {
                                                cellStyle = { backgroundColor: getHeatmapColor(metric.key, value) };
                                            } else {
                                                const allValues = peers.map(s => comparisonData[s]?.metrics?.[metric.key]).filter(v => typeof v === 'number');
                                                const min = Math.min(...allValues);
                                                const max = Math.max(...allValues);
                                                if (value === max && allValues.length > 1) cellClass += " text-green-400";
                                                else if (value === min && allValues.length > 1) cellClass += " text-red-400";
                                                else cellClass += " text-[var(--text-secondary)]";
                                            }
                                        }

                                        return (
                                            <td key={`${sym}-${index}`} className={cellClass} style={cellStyle}>
                                                {formatCellValue(value, metric.format, unitConfig)}
                                            </td>
                                        );

                                    })}
                                    <td className="text-right px-2 font-mono text-amber-400/60 border-l border-[var(--border-subtle)]">
                                        {sectorValue !== undefined ? formatCellValue(sectorValue, metric.format, unitConfig) : '-'}
                                        {sectorAverageCounts?.[metric.key] ? (
                                            <span className="ml-1 text-[8px] text-[var(--text-muted)]">(n={sectorAverageCounts[metric.key]})</span>
                                        ) : null}
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
            <div className="flex min-h-[220px] flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                    <Radar size={14} /> Key Metrics Comparison
                </h3>
                <ChartSizeBox className="flex-1 min-h-0" minHeight={180}>
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
            <div className="flex min-h-[220px] flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
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
                <ChartSizeBox className="flex-1 min-h-0" minHeight={180}>
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
                            <div
                                key={`${sym}-${index}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setLinkedSymbol(sym)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        setLinkedSymbol(sym);
                                    }
                                }}
                                className="flex items-center gap-1 bg-[var(--bg-tertiary)] px-2 py-0.5 rounded text-[10px] font-medium group hover:bg-[var(--bg-hover)] cursor-pointer"
                                aria-label={`Set comparison symbol to ${sym}`}
                            >
                                <span>{sym}</span>
                                {peers.length > 2 && (
                                    <button onClick={(event) => { event.stopPropagation(); removePeer(sym); }} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity" aria-label={`Remove ${sym}`}>
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
                                                    onClick={() => setSets((current) => current.filter((entry) => entry.id !== set.id))}
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
function formatCellValue(value: any, format: string, unitConfig: UnitConfig) {
    if (value === null || value === undefined) return EMPTY_VALUE;
    if (typeof value !== 'number') return String(value);

    switch (format) {
        case 'currency':
            return formatCompactValueForUnit(value, { ...unitConfig, decimalPlaces: 1 });
        case 'percent':
            return formatPercent(value, { decimals: 1, input: 'auto', clamp: 'margin' });
        case 'large_number':
            return formatCompactValueForUnit(value, { ...unitConfig, decimalPlaces: 1 });
        case 'ratio':
            return formatNumber(value, { decimals: 2 });
        default:
            return formatNumber(value, { decimals: 2 });
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
