'use client';

import { useState, useMemo, memo } from 'react';
import { useDashboard } from '@/contexts/DashboardContext';
import { widgetCategories, widgetDefinitions } from '@/data/widgetDefinitions';
import {
    Search, X, Grid3X3, ChevronRight, Check,
    Box, Star, BarChart3, DollarSign, TrendingUp,
    Newspaper, PieChart, Info, LayoutGrid, Layers,
    Plus, Clock, Maximize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { WidgetPreview } from './WidgetPreview';

interface WidgetLibraryProps {
    isOpen: boolean;
    onClose: () => void;
}

const CATEGORY_ICONS: Record<string, any> = {
    'core_data': BarChart3,
    'financials': DollarSign,
    'charting': TrendingUp,
    'calendar': Newspaper,
    'screener': Search,
    'analysis': PieChart,
    'ownership': Box,
    'estimates': Star,
};

function WidgetLibraryComponent({ isOpen, onClose }: WidgetLibraryProps) {
    const { activeDashboard, activeTab, addWidget } = useDashboard();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);

    // Persistent recent widgets
    const [recentWidgetTypes, setRecentWidgetTypes] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = localStorage.getItem('vnibb_recent_widgets');
        return saved ? JSON.parse(saved) : ['price_chart', 'screener', 'unified_financials', 'news_flow'];
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

    const handleAddWidget = (widgetDef: any) => {
        if (!activeDashboard || !activeTab) return;

        let yOffset = activeTab.widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);

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

        // Update recents
        const newRecents = [widgetDef.type, ...recentWidgetTypes.filter(t => t !== widgetDef.type)].slice(0, 10);
        setRecentWidgetTypes(newRecents);
        localStorage.setItem('vnibb_recent_widgets', JSON.stringify(newRecents));
    };

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
                        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[40]"
                    />

                    {/* Sidebar */}
                    <motion.div
                        initial={{ x: -350, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -350, opacity: 0 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed left-16 md:left-[220px] top-4 bottom-4 w-[calc(100vw-5rem)] md:w-96 max-w-[28rem] bg-gray-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl z-[65] flex flex-col shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/30">
                            <div className="flex items-center gap-2">
                                <Layers size={18} className="text-blue-500" />
                                <span className="text-sm font-black uppercase tracking-widest text-white">Components</span>
                            </div>
                            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded text-gray-500 hover:text-white transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="p-3 border-b border-gray-800 bg-black/20">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
                                <input
                                    type="text"
                                    autoFocus
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search widgets..."
                                    className="w-full pl-9 pr-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-xs text-white placeholder-gray-700 outline-none focus:border-blue-500/50 transition-all font-medium"
                                />
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide">
                            {/* Recents */}
                            {searchQuery === '' && recentWidgetTypes.length > 0 && (
                                <div className="border-b border-gray-800/50">
                                    <div className="px-4 py-2 text-[9px] font-black text-gray-700 uppercase tracking-[0.2em] bg-black/10 flex items-center gap-2">
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
                                                    className="p-2 rounded-lg bg-gray-900/50 border border-gray-800 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-left group"
                                                >
                                                    <div className="text-[10px] font-bold text-gray-400 group-hover:text-blue-400 truncate uppercase tracking-tighter">
                                                        {widget.name}
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

                                return (
                                    <div key={cat.id} className="border-b border-gray-800/50 last:border-0">
                                        <button
                                            onClick={() => setActiveCategory(isExpanded && searchQuery === '' ? null : cat.id)}
                                            className={cn(
                                                "w-full flex items-center justify-between px-4 py-3 text-left transition-colors",
                                                isExpanded ? "bg-blue-600/5" : "hover:bg-white/5"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Icon size={16} className={cn(isExpanded ? "text-blue-400" : "text-gray-500")} />
                                                <span className={cn("text-[11px] font-bold uppercase tracking-tighter", isExpanded ? "text-white" : "text-gray-400")}>
                                                    {cat.name}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-gray-700 font-black">{cat.widgets.length}</span>
                                                <ChevronRight size={14} className={cn("text-gray-700 transition-transform duration-200", isExpanded && "rotate-90 text-blue-500")} />
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="p-1 space-y-1 bg-black/10">
                                                {cat.widgets.map((widget) => (
                                                    <div
                                                        key={widget.type}
                                                        className="p-3 rounded-xl border border-transparent hover:border-gray-800 hover:bg-gray-900/50 transition-all group cursor-default"
                                                    >
                                                        <div className="flex items-start justify-between mb-1">
                                                            <div className="text-[11px] font-black text-gray-200 group-hover:text-blue-400 transition-colors uppercase tracking-tight">
                                                                {widget.name}
                                                            </div>
                                                            <button
                                                                onClick={() => handleAddWidget(widget)}
                                                                className="p-1 rounded bg-blue-600 text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95 shadow-lg shadow-blue-600/20"
                                                            >
                                                                <Plus size={14} strokeWidth={3} />
                                                            </button>
                                                        </div>
                                                        <div className="text-[10px] text-gray-600 line-clamp-2 leading-tight font-medium">
                                                            {widget.description}
                                                        </div>

                                                        {/* Enhanced Preview Thumbnail */}
                                                        <div className="mt-3 h-20 bg-gradient-to-b from-gray-950 to-gray-900 rounded-xl border border-gray-800/50 relative overflow-hidden group-hover:border-blue-500/30 transition-all">
                                                            <WidgetPreview type={widget.type} />
                                                            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                                            <div className="absolute bottom-1.5 left-2 right-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <span className="text-[7px] font-bold text-gray-600 bg-gray-900/80 px-1 rounded">
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
                        <div className="p-4 border-t border-gray-800 bg-gray-900/50">
                            <div className="flex items-center gap-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                                <Info size={14} className="text-blue-500" />
                                <span>Click + to add to dashboard</span>
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
