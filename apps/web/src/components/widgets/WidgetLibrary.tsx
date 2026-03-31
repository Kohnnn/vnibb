'use client';

import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { useDashboard } from '@/contexts/DashboardContext';
import { widgetCategories, widgetDefinitions } from '@/data/widgetDefinitions';
import {
    Search, X, ChevronRight,
    Box, Star, BarChart3, DollarSign, TrendingUp, Globe,
    Newspaper, PieChart, Info, Layers,
    Plus, Clock, Maximize2, Sigma
} from 'lucide-react';
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
    'core_data': BarChart3,
    'financials': DollarSign,
    'charting': TrendingUp,
    'global_markets': Globe,
    'quant': Sigma,
    'calendar': Newspaper,
    'screener': Search,
    'analysis': PieChart,
    'ownership': Box,
    'estimates': Star,
};

const WIDGET_TYPE_SET = new Set<WidgetType>(widgetDefinitions.map((widget) => widget.type));

function isWidgetType(value: string): value is WidgetType {
    return WIDGET_TYPE_SET.has(value as WidgetType);
}

function WidgetLibraryComponent({ isOpen, onClose }: WidgetLibraryProps) {
    const { activeDashboard, activeTab, addWidget } = useDashboard();
    const dashboardEditable = (activeDashboard?.isEditable ?? true) !== false;
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

    // Persistent recent widgets
    const [recentWidgetTypes, setRecentWidgetTypes] = useState<WidgetType[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = localStorage.getItem('vnibb_recent_widgets');
        if (saved) {
            try {
                return (JSON.parse(saved) as string[]).filter(isWidgetType);
            } catch {
                return ['price_chart', 'screener', 'financials', 'news_feed'];
            }
        }
        return ['price_chart', 'screener', 'financials', 'news_feed'];
    });

    const filteredCategories = useMemo(() => {
        return widgetCategories.map(cat => ({
            ...cat,
            widgets: widgetDefinitions.filter(w =>
                w.category === cat.id && (
                    searchQuery === '' ||
                    w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    w.description.toLowerCase().includes(searchQuery.toLowerCase())
                )
            )
        })).filter(cat => cat.widgets.length > 0);
    }, [searchQuery]);

    const handleAddWidgets = useCallback((widgetDefs: any[]) => {
        if (!activeDashboard || !activeTab || !dashboardEditable) return;

        let yOffset = activeTab.widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);

        widgetDefs.forEach((widgetDef) => {
            addWidget(activeDashboard.id, activeTab.id, {
                type: widgetDef.type,
                tabId: activeTab.id,
                layout: {
                    x: 0,
                    y: yOffset,
                    ...widgetDef.defaultLayout
                },
                config: widgetDef.defaultConfig
            });
            yOffset += widgetDef.defaultLayout.h;
        });

        const addedTypes = widgetDefs.map((widgetDef) => widgetDef.type);
        const newRecents = [
            ...addedTypes.slice().reverse(),
            ...recentWidgetTypes.filter((type) => !addedTypes.includes(type))
        ].slice(0, 10);
        setRecentWidgetTypes(newRecents);
        localStorage.setItem('vnibb_recent_widgets', JSON.stringify(newRecents));
    }, [activeDashboard, activeTab, addWidget, dashboardEditable, recentWidgetTypes]);

    const handleAddWidget = useCallback((widgetDef: any) => {
        handleAddWidgets([widgetDef]);
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
            .map((type) => definitionsByType.get(type))
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
                                <span className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Components</span>
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
                                    placeholder="Search widgets..."
                                    className="w-full pl-9 pr-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-500/50 transition-all font-medium"
                                />
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide">
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
                                                {cat.widgets.map((widget) => (
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
                                                                className="p-1 rounded bg-blue-600 text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95 shadow-lg shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                                                            >
                                                                <Plus size={14} strokeWidth={3} />
                                                            </button>
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-tight font-medium">
                                                            {widget.description}
                                                        </div>
                                                        {widget.recommended && (
                                                            <div className="mt-2 inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                                                                Recommended
                                                            </div>
                                                        )}

                                                        {/* Enhanced Preview Thumbnail */}
                                                        <div className="mt-3 h-20 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] relative overflow-hidden group-hover:border-blue-500/30 transition-all">
                                                            <WidgetPreview type={widget.type} />
                                                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.2)] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                                                            <div className="absolute bottom-1.5 left-2 right-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <span className="text-[7px] font-bold text-[var(--text-muted)] bg-[var(--bg-surface)] px-1 rounded">
                                                                    {widget.defaultLayout.w}×{widget.defaultLayout.h}
                                                                </span>
                                                                <Maximize2 size={10} className="text-blue-400/60" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
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
