'use client';

import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { useDashboard } from '@/contexts/DashboardContext';
import { getWidgetDefinition, getWidgetLibrarySectionId, normalizeWidgetType, widgetDefinitions, widgetLibrarySections } from '@/data/widgetDefinitions';
import {
    Search, X, ChevronRight,
    Activity, BarChart3, Brain, Box, Globe,
    Info, Layers, Newspaper, TrendingUp,
    Plus, Clock, Maximize2, Sigma, Package
} from 'lucide-react';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { WidgetPreview } from './WidgetPreview';
import { Checkbox } from '@/components/ui/checkbox';
import type { WidgetType } from '@/types/dashboard';

interface WidgetLibraryProps {
    isOpen: boolean;
    onClose: () => void;
}

const CATEGORY_ICONS: Record<string, any> = {
    'fundamentals': BarChart3,
    'market': Activity,
    'charting': TrendingUp,
    'global_markets': Globe,
    'quant_signals': Sigma,
    'ownership': Box,
    'news_events': Newspaper,
    'ai_research': Brain,
    'screeners_tools': Layers,
};

const WIDGET_TYPE_SET = new Set<WidgetType>(widgetDefinitions.map((widget) => widget.type));

interface WidgetBundle {
    id: string;
    name: string;
    description: string;
    widgetTypes: WidgetType[];
    tags: string[];
    accent: string;
}

const WIDGET_BUNDLES: WidgetBundle[] = [
    {
        id: 'world-monitor-suite',
        name: 'World Monitor Suite',
        description: 'Map, live stream, headline list, and source registry for global risk monitoring.',
        widgetTypes: ['world_news_map', 'world_news_live_stream', 'world_news_monitor', 'world_news_sources'],
        tags: ['Live RSS', 'No symbol', 'Global'],
        accent: 'from-sky-500/20 via-blue-500/10 to-emerald-500/10',
    },
    {
        id: 'market-pulse-pack',
        name: 'Market Pulse Pack',
        description: 'Market overview, movers, breadth, heatmap, and news for top-down scanning.',
        widgetTypes: ['market_overview', 'top_movers', 'market_breadth', 'market_heatmap', 'market_news'],
        tags: ['Market', 'Scanner', 'Live'],
        accent: 'from-blue-500/20 via-cyan-500/10 to-emerald-500/10',
    },
    {
        id: 'fundamental-core-pack',
        name: 'Fundamental Core',
        description: 'Financial snapshot, ratios, statements, and peer context for company research.',
        widgetTypes: ['financial_snapshot', 'financial_ratios', 'income_statement', 'balance_sheet', 'peer_comparison'],
        tags: ['Research', 'Symbol', 'Statements'],
        accent: 'from-amber-500/20 via-orange-500/10 to-blue-500/10',
    },
];

const GLOBAL_WIDGETS = new Set<WidgetType>([
    'world_indices',
    'world_news_monitor',
    'world_news_map',
    'world_news_live_stream',
    'world_news_sources',
    'forex_rates',
    'commodities',
    'economic_calendar',
    'tradingview_market_overview',
    'tradingview_market_data',
    'tradingview_ticker_tape',
    'tradingview_stock_heatmap',
    'tradingview_top_stories',
]);

const LIVE_WIDGETS = new Set<WidgetType>([
    'world_news_monitor',
    'world_news_map',
    'world_news_live_stream',
    'world_news_sources',
    'market_news',
    'market_overview',
    'top_movers',
    'market_breadth',
    'market_heatmap',
    'intraday_trades',
    'orderbook',
]);

function getWidgetScopeLabel(type: WidgetType): string {
    if (GLOBAL_WIDGETS.has(type)) return 'Global';
    if (type.includes('market') || type.includes('sector') || type === 'top_movers') return 'Market';
    if (type === 'notes' || type === 'watchlist' || type === 'portfolio_tracker' || type === 'price_alerts') return 'Workspace';
    return 'Symbol';
}

function getWidgetDataLabel(type: WidgetType): string {
    if (type.startsWith('tradingview_')) return 'TradingView';
    if (type.startsWith('world_news_')) return 'Live RSS';
    if (LIVE_WIDGETS.has(type)) return 'Live API';
    if (type === 'notes' || type === 'watchlist') return 'Local';
    return 'VNIBB API';
}

function isWidgetType(value: string): value is WidgetType {
    const normalized = normalizeWidgetType(value);
    return normalized != null && WIDGET_TYPE_SET.has(normalized);
}

function WidgetLibraryComponent({ isOpen, onClose }: WidgetLibraryProps) {
    const { activeDashboard, activeTab, addWidget } = useDashboard();
    const dashboardEditable = activeDashboard?.adminUnlocked === true || (activeDashboard?.isEditable ?? true) !== false;
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [selectedWidgetTypes, setSelectedWidgetTypes] = useState<WidgetType[]>([]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen) return;
        setSearchQuery('');
        setActiveCategory(null);
        setSelectedWidgetTypes([]);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        captureAnalyticsEvent(ANALYTICS_EVENTS.widgetLibraryOpened, {
            dashboard_id: activeDashboard?.id,
            tab_id: activeTab?.id,
        });
    }, [activeDashboard?.id, activeTab?.id, isOpen]);

    // Persistent recent widgets
    const [recentWidgetTypes, setRecentWidgetTypes] = useState<WidgetType[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = localStorage.getItem('vnibb_recent_widgets');
        if (saved) {
            try {
                return Array.from(
                    new Set(
                        (JSON.parse(saved) as string[])
                            .map((value) => normalizeWidgetType(value))
                            .filter((value): value is WidgetType => value != null)
                    )
                );
            } catch {
                return ['price_chart', 'screener', 'unified_financials', 'news_feed'];
            }
        }
        return ['price_chart', 'screener', 'unified_financials', 'news_feed'];
    });

    const filteredCategories = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        const matchesWidget = (widget: typeof widgetDefinitions[number]) => {
            if (!normalizedQuery) return true;
            return (
                widget.name.toLowerCase().includes(normalizedQuery) ||
                widget.description.toLowerCase().includes(normalizedQuery) ||
                (widget.searchKeywords || []).some((keyword) => keyword.toLowerCase().includes(normalizedQuery))
            );
        };

        return widgetLibrarySections.map(cat => ({
            ...cat,
            widgets: widgetDefinitions.filter((widget) => getWidgetLibrarySectionId(widget.type) === cat.id && matchesWidget(widget))
        })).filter(cat => cat.widgets.length > 0);
    }, [searchQuery]);

    const handleAddWidgets = useCallback((widgetDefs: any[]) => {
        if (!activeDashboard || !activeTab || !dashboardEditable) return;

        let yOffset = activeTab.widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);

        widgetDefs.forEach((widgetDef) => {
            const defaultLayout = getWidgetDefaultLayout(widgetDef.type);
            addWidget(activeDashboard.id, activeTab.id, {
                type: widgetDef.type,
                tabId: activeTab.id,
                layout: {
                    ...defaultLayout,
                    x: 0,
                    y: yOffset,
                },
                config: widgetDef.defaultConfig
            });
            yOffset += defaultLayout.h;
        });

        const addedTypes = widgetDefs.map((widgetDef) => widgetDef.type);
        const newRecents = [
            ...addedTypes.slice().reverse(),
            ...recentWidgetTypes.filter((type) => !addedTypes.includes(type))
        ].slice(0, 10);
        setRecentWidgetTypes(newRecents);
        localStorage.setItem('vnibb_recent_widgets', JSON.stringify(newRecents));

        if (widgetDefs.length > 1) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetBatchAdded, {
                source: 'widget_library',
                dashboard_id: activeDashboard.id,
                tab_id: activeTab.id,
                widget_count: widgetDefs.length,
                widget_types: addedTypes,
            });
        }
    }, [activeDashboard, activeTab, addWidget, dashboardEditable, recentWidgetTypes]);

    const handleAddWidget = useCallback((widgetDef: any) => {
        handleAddWidgets([widgetDef]);
    }, [handleAddWidgets]);

    const handleAddBundle = useCallback((bundle: WidgetBundle) => {
        const bundleDefinitions = bundle.widgetTypes
            .map((type) => getWidgetDefinition(type))
            .filter((widget): widget is NonNullable<typeof widget> => Boolean(widget));

        handleAddWidgets(bundleDefinitions);
    }, [handleAddWidgets]);

    const toggleWidgetSelection = useCallback((widgetType: WidgetType, checked: boolean) => {
        setSelectedWidgetTypes((current) => {
            if (checked) {
                return current.includes(widgetType) ? current : [...current, widgetType];
            }
            return current.filter((type) => type !== widgetType);
        });
    }, []);

    const selectCategoryWidgets = useCallback((widgetTypes: WidgetType[]) => {
        if (!dashboardEditable || widgetTypes.length === 0) return;
        setSelectedWidgetTypes((current) => Array.from(new Set([...current, ...widgetTypes])));
    }, [dashboardEditable]);

    const clearCategoryWidgets = useCallback((widgetTypes: WidgetType[]) => {
        if (widgetTypes.length === 0) return;
        const widgetTypeSet = new Set(widgetTypes);
        setSelectedWidgetTypes((current) => current.filter((type) => !widgetTypeSet.has(type)));
    }, []);

    const handleAddSelected = useCallback(() => {
        if (!selectedWidgetTypes.length) return;
        const definitionsByType = new Map(widgetDefinitions.map((widget) => [widget.type, widget]));
        const selectedDefinitions = selectedWidgetTypes
            .map((type) => definitionsByType.get(type) || getWidgetDefinition(type))
            .filter((widget): widget is NonNullable<typeof widget> => Boolean(widget));

        handleAddWidgets(selectedDefinitions);
        setSelectedWidgetTypes([]);
    }, [handleAddWidgets, selectedWidgetTypes]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[40] bg-[rgba(0,0,0,0.5)]"
                    />

                    {/* Sidebar */}
                    <motion.div
                        initial={{ x: -350, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -350, opacity: 0 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed left-16 md:left-[220px] top-4 bottom-4 w-[calc(100vw-5rem)] md:w-96 max-w-[28rem] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-2xl z-[65] flex flex-col shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--bg-elevated)]">
                            <div className="flex items-center gap-2">
                                <Layers size={18} className="text-blue-500" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Add Widgets</span>
                                    <p className="mt-0.5 text-[10px] font-medium text-[var(--text-muted)]">Pick one widget, select many, or add a curated bundle.</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="p-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                <input
                                    type="text"
                                    autoFocus
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search widgets, bundles, or data sources..."
                                    className="w-full pl-9 pr-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-500/50 transition-all font-medium"
                                />
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide">
                            {/* Recommended bundles */}
                            {searchQuery === '' && (
                                <div className="border-b border-[var(--border-subtle)]">
                                    <div className="px-4 py-2 text-[9px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] bg-[var(--bg-secondary)] flex items-center gap-2">
                                        <Package size={10} />
                                        Recommended Bundles
                                    </div>
                                    <div className="space-y-2 p-2">
                                        {WIDGET_BUNDLES.map((bundle) => (
                                            <div
                                                key={bundle.id}
                                                className={cn(
                                                    'overflow-hidden rounded-xl border border-[var(--border-default)] bg-gradient-to-br p-3 transition-all hover:border-blue-500/35',
                                                    bundle.accent
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-black uppercase tracking-tight text-[var(--text-primary)]">
                                                            {bundle.name}
                                                        </div>
                                                        <p className="mt-1 text-[10px] leading-snug text-[var(--text-secondary)]">
                                                            {bundle.description}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAddBundle(bundle)}
                                                        disabled={!dashboardEditable}
                                                        className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {bundle.tags.map((tag) => (
                                                        <span key={tag} className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                    <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                                                        {bundle.widgetTypes.length} widgets
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Recents */}
                            {searchQuery === '' && recentWidgetTypes.length > 0 && (
                                <div className="border-b border-[var(--border-subtle)]">
                                    <div className="px-4 py-2 text-[9px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] bg-[var(--bg-secondary)] flex items-center gap-2">
                                        <Clock size={10} />
                                        Recently Used
                                    </div>
                                    <div className="p-2 grid grid-cols-2 gap-2">
                                        {recentWidgetTypes.map(type => {
                                            const widget = widgetDefinitions.find(w => w.type === type);
                                            if (!widget) return null;
                                            return (
                                                <button
                                                    key={type}
                                                    onClick={() => handleAddWidget(widget)}
                                                    className="p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-left group"
                                                >
                                                    <div className="mb-1 flex items-start justify-between gap-2">
                                                        <div className="text-[10px] font-bold text-[var(--text-secondary)] group-hover:text-blue-400 truncate uppercase tracking-tighter">
                                                            {widget.name}
                                                        </div>
                                                        <Checkbox
                                                            checked={selectedWidgetTypes.includes(widget.type)}
                                                            onCheckedChange={(checked) => toggleWidgetSelection(widget.type, checked)}
                                                            onClick={(event) => event.stopPropagation()}
                                                            aria-label={`Select ${widget.name}`}
                                                            disabled={!dashboardEditable}
                                                        />
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Categories */}
                            {filteredCategories.map((cat) => {
                                const Icon = CATEGORY_ICONS[cat.id] || Box;
                                const isExpanded = activeCategory === cat.id || searchQuery !== '';
                                const categoryWidgetTypes = cat.widgets.map((widget) => widget.type);
                                const selectedInCategory = categoryWidgetTypes.filter((type) =>
                                    selectedWidgetTypes.includes(type)
                                ).length;

                                return (
                                    <div key={cat.id} className="border-b border-[var(--border-subtle)] last:border-0">
                                        <button
                                            onClick={() => setActiveCategory(isExpanded && searchQuery === '' ? null : cat.id)}
                                            className={cn(
                                                "w-full flex items-center justify-between px-4 py-3 text-left transition-colors",
                                                isExpanded ? "bg-blue-600/5" : "hover:bg-[var(--bg-hover)]"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Icon size={16} className={cn(isExpanded ? "text-blue-400" : "text-[var(--text-muted)]")} />
                                                <span className={cn("text-[11px] font-bold uppercase tracking-tighter", isExpanded ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                                                    {cat.name}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-[var(--text-muted)] font-black">{cat.widgets.length}</span>
                                                <ChevronRight size={14} className={cn("text-[var(--text-muted)] transition-transform duration-200", isExpanded && "rotate-90 text-blue-500")} />
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="p-1 space-y-1 bg-[var(--bg-secondary)]/60">
                                                <div className="flex items-center justify-between rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                                    <span>{selectedInCategory} selected</span>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => selectCategoryWidgets(categoryWidgetTypes)}
                                                            disabled={!dashboardEditable || categoryWidgetTypes.length === 0}
                                                            className="rounded-md border border-[var(--border-default)] px-2 py-1 transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            Select All
                                                        </button>
                                                        {selectedInCategory > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => clearCategoryWidgets(categoryWidgetTypes)}
                                                                className="rounded-md border border-[var(--border-default)] px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]"
                                                            >
                                                                Clear
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {cat.widgets.map((widget) => {
                                                    const libraryLayout = getWidgetDefaultLayout(widget.type)

                                                    return (
                                                    <div
                                                        key={widget.type}
                                                        className={cn(
                                                            "p-3 rounded-xl border transition-all group cursor-default",
                                                            selectedWidgetTypes.includes(widget.type)
                                                                ? "border-blue-500/40 bg-blue-500/5"
                                                                : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)]"
                                                        )}
                                                    >
                                                        <div className="flex items-start justify-between mb-1">
                                                            <div className="flex min-w-0 items-start gap-2">
                                                                <Checkbox
                                                                    checked={selectedWidgetTypes.includes(widget.type)}
                                                                    onCheckedChange={(checked) => toggleWidgetSelection(widget.type, checked)}
                                                                    aria-label={`Select ${widget.name}`}
                                                                    disabled={!dashboardEditable}
                                                                />
                                                                <div className="min-w-0">
                                                                    <div className="text-[11px] font-black text-[var(--text-primary)] group-hover:text-blue-400 transition-colors uppercase tracking-tight">
                                                                        {widget.name}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleAddWidget(widget)}
                                                                disabled={!dashboardEditable}
                                                                title={dashboardEditable ? `Add ${widget.name}` : 'Main dashboard is read-only'}
                                                                className="rounded-lg bg-blue-600 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white transition-all hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                                <span className="flex items-center gap-1">
                                                                    <Plus size={12} strokeWidth={3} />
                                                                    Add
                                                                </span>
                                                            </button>
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-tight font-medium">
                                                            {widget.description}
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                                            {widget.recommended && (
                                                                <div className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                                                                    Recommended
                                                                </div>
                                                            )}
                                                            <div className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                                                {getWidgetScopeLabel(widget.type)}
                                                            </div>
                                                            <div className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                                                {getWidgetDataLabel(widget.type)}
                                                            </div>
                                                            <div className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                                                <Maximize2 size={10} className="text-blue-400/60" />
                                                                {libraryLayout.w}x{libraryLayout.h}
                                                            </div>
                                                        </div>

                                                        {/* Enhanced Preview Thumbnail */}
                                                        <div className="mt-3 h-20 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] relative overflow-hidden group-hover:border-blue-500/30 transition-all">
                                                            <WidgetPreview type={widget.type} />
                                                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.2)] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                                                            <div className="absolute bottom-1.5 left-2 right-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <span className="text-[7px] font-bold text-[var(--text-muted)] bg-[var(--bg-surface)] px-1 rounded">
                                                                    {libraryLayout.w}×{libraryLayout.h}
                                                                </span>
                                                                <Maximize2 size={10} className="text-blue-400/60" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )})}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                                    <Info size={14} className="text-blue-500" />
                                    <span>
                                        {selectedWidgetTypes.length > 0
                                            ? `${selectedWidgetTypes.length} selected`
                                            : 'Click + or select multiple widgets'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedWidgetTypes.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedWidgetTypes([])}
                                            className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                        >
                                            Clear
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleAddSelected}
                                        disabled={!dashboardEditable || selectedWidgetTypes.length === 0}
                                        className="rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Add Selected ({selectedWidgetTypes.length})
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export const WidgetLibrary = memo(WidgetLibraryComponent);
export default WidgetLibrary;
