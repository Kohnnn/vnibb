'use client';

import { useState, useMemo } from 'react';
import { useDashboard } from '@/contexts/DashboardContext';
import { widgetCategories, widgetDefinitions } from '@/data/widgetDefinitions';
import {
    Search, X, Grid3X3, ChevronRight, Check,
    Box, Star, BarChart3, DollarSign, TrendingUp, 
    Newspaper, PieChart, Info, LayoutGrid, Layers,
    Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WidgetLibrarySidebarProps {
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

export function WidgetLibrarySidebar({ isOpen, onClose }: WidgetLibrarySidebarProps) {
    const { activeDashboard, activeTab, addWidget } = useDashboard();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);

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
    };

    if (!isOpen) return null;

    return (
        <div 
            className={cn(
                "fixed left-52 top-0 bottom-0 w-80 bg-secondary border-r border-gray-800 z-[45] flex flex-col shadow-2xl transition-transform duration-300 animate-in slide-in-from-left-4",
                !isOpen && "translate-x-[-100%]"
            )}
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
                        className="w-full pl-9 pr-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-xs text-white placeholder-gray-700 outline-none focus:border-blue-500/50 transition-all"
                    />
                </div>
            </div>

            {/* Categories & Widgets */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
                {filteredCategories.map((cat) => {
                    const Icon = CATEGORY_ICONS[cat.id] || Box;
                    const isExpanded = activeCategory === cat.id;

                    return (
                        <div key={cat.id} className="border-b border-gray-800/50 last:border-0">
                            <button 
                                onClick={() => setActiveCategory(isExpanded ? null : cat.id)}
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
                                            
                                            {/* Preview Placeholder */}
                                            <div className="mt-3 h-16 bg-gray-950 rounded-lg border border-gray-900 flex items-center justify-center relative overflow-hidden group-hover:border-gray-800 transition-colors">
                                                <Icon size={24} className="text-gray-900 absolute" />
                                                <div className="text-[8px] font-black text-gray-800 uppercase tracking-[0.2em] z-10">Preview</div>
                                                <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 to-transparent" />
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
                    <span>Drag and drop coming soon</span>
                </div>
            </div>
        </div>
    );
}
