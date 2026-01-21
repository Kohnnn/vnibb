// Apps/Templates Library - Pre-configured dashboard templates

'use client';

import { useState } from 'react';
import { X, Layout, TrendingUp, BarChart3, LineChart, Globe, Briefcase, Search } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import type { WidgetType } from '@/types/dashboard';

interface AppTemplate {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    category: 'market' | 'analysis' | 'research';
    widgets: { type: WidgetType; config?: Record<string, unknown> }[];
    color: string;
}

const APP_TEMPLATES: AppTemplate[] = [
    {
        id: 'vietnam-overview',
        name: 'Vietnam Market Overview',
        description: 'Complete overview of Vietnam stock market with screener, charts, and company profiles',
        icon: <Globe size={24} />,
        category: 'market',
        color: '#3B82F6',
        widgets: [
            { type: 'screener' },
            { type: 'price_chart' },
            { type: 'ticker_profile' },
            { type: 'key_metrics' },
        ],
    },
    {
        id: 'technical-analysis',
        name: 'Technical Analysis',
        description: 'Price charts, technical indicators, and trading signals',
        icon: <LineChart size={24} />,
        category: 'analysis',
        color: '#10B981',
        widgets: [
            { type: 'price_chart' },
            { type: 'ticker_info' },
            { type: 'share_statistics' },
        ],
    },
    {
        id: 'fundamental-research',
        name: 'Fundamental Research',
        description: 'Financial statements, key metrics, company filings, and ownership analysis',
        icon: <Briefcase size={24} />,
        category: 'research',
        color: '#8B5CF6',
        widgets: [
            { type: 'ticker_profile' },
            { type: 'key_metrics' },
            { type: 'earnings_history' },
            { type: 'company_filings' },
        ],
    },
    {
        id: 'earnings-calendar',
        name: 'Company Calendar',
        description: 'Track earnings, dividends, stock splits, and corporate filings',
        icon: <BarChart3 size={24} />,
        category: 'research',
        color: '#F59E0B',
        widgets: [
            { type: 'earnings_history' },
            { type: 'dividend_payment' },
            { type: 'stock_splits' },
            { type: 'company_filings' },
        ],
    },
];

interface AppsLibraryProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AppsLibrary({ isOpen, onClose }: AppsLibraryProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<'all' | 'market' | 'analysis' | 'research'>('all');
    const { createDashboard, addWidget, setActiveDashboard, activeDashboard } = useDashboard();

    if (!isOpen) return null;

    const filteredTemplates = APP_TEMPLATES.filter(template => {
        const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            template.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const handleApplyTemplate = (template: AppTemplate) => {
        // Create a new dashboard with the template name
        const dashboard = createDashboard({
            name: template.name,
        });

        // Add widgets to the first tab
        const tabId = dashboard.tabs[0]?.id;
        if (tabId) {
            template.widgets.forEach((widget, index) => {
                const col = index % 2;
                const row = Math.floor(index / 2);
                addWidget(dashboard.id, tabId, {
                    type: widget.type,
                    tabId,
                    config: widget.config || {},
                    layout: { x: col * 6, y: row * 4, w: 6, h: 4 }
                });
            });
        }

        setActiveDashboard(dashboard.id);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-3xl max-h-[80vh] bg-[#0b1021] border border-[#1e2a3b] rounded-lg shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2a3b]">
                    <div>
                        <h2 className="text-base font-semibold text-white">Apps Library</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Pre-configured dashboard templates</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Search and Filters */}
                <div className="px-4 py-3 border-b border-[#1e2a3b]">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                placeholder="Search templates..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 rounded bg-[#0f1629] border border-[#1e2a3b] text-white text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                        <div className="flex gap-1">
                            {(['all', 'market', 'analysis', 'research'] as const).map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${selectedCategory === cat
                                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]'
                                        }`}
                                >
                                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Templates Grid */}
                <div className="p-4 overflow-y-auto max-h-[calc(80vh-140px)]">
                    <div className="grid grid-cols-2 gap-3">
                        {filteredTemplates.map(template => (
                            <button
                                key={template.id}
                                onClick={() => handleApplyTemplate(template)}
                                className="group flex flex-col p-4 rounded-lg border border-[#1e2a3b] bg-[#0f1629]/50 hover:bg-[#1e2a3b]/50 hover:border-[#2e3a4b] transition-all text-left"
                            >
                                {/* Icon */}
                                <div
                                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                                    style={{ backgroundColor: `${template.color}20`, color: template.color }}
                                >
                                    {template.icon}
                                </div>

                                {/* Content */}
                                <h3 className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">
                                    {template.name}
                                </h3>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                    {template.description}
                                </p>

                                {/* Widget count */}
                                <div className="mt-3 flex items-center gap-1.5">
                                    <Layout size={12} className="text-gray-600" />
                                    <span className="text-[10px] text-gray-600">
                                        {template.widgets.length} widgets
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>

                    {filteredTemplates.length === 0 && (
                        <div className="text-center py-8">
                            <p className="text-gray-500 text-sm">No templates found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
