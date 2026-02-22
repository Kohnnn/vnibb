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
            { type: 'market_movers_sectors' },
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
        color: '#06B6D4',
        widgets: [
            { type: 'ticker_profile' },
            { type: 'key_metrics' },
            { type: 'earnings_history' },
            { type: 'company_filings' },
            { type: 'news_corporate_actions' },
        ],
    },
    {
        id: 'fundamental-deep-dive',
        name: 'Fundamental Deep Dive',
        description: 'Long-term research setup with statements, ratios, and side-by-side comparison',
        icon: <Briefcase size={24} />,
        category: 'research',
        color: '#14B8A6',
        widgets: [
            { type: 'ticker_profile' },
            { type: 'key_metrics' },
            { type: 'income_statement' },
            { type: 'balance_sheet' },
            { type: 'cash_flow' },
            { type: 'financial_ratios' },
            { type: 'comparison_analysis' },
        ],
    },
    {
        id: 'dividend-value',
        name: 'Dividend & Value',
        description: 'Yield-focused workflow with dividend ladder, valuation, and corporate action tracking',
        icon: <TrendingUp size={24} />,
        category: 'research',
        color: '#22C55E',
        widgets: [
            { type: 'key_metrics' },
            { type: 'dividend_ladder' },
            { type: 'dividend_payment' },
            { type: 'financial_ratios' },
            { type: 'events_calendar' },
            { type: 'news_corporate_actions' },
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
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                role="button"
                tabIndex={0}
                aria-label="Close apps library"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClose();
                    }
                }}
                onClick={onClose}
            />

                {/* Modal */}
                <div className="relative w-full max-w-3xl max-h-[80vh] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
                        <div>
                            <h2 className="text-base font-semibold text-[var(--text-primary)]">Apps Library</h2>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Pre-configured dashboard templates</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            aria-label="Close apps library"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Search and Filters */}
                    <div className="px-4 py-3 border-b border-[var(--border-color)] shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="relative flex-1">
                                <Search
                                    size={14}
                                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                                />
                                <input
                                    type="text"
                                    placeholder="Search templates..."
                                    value={searchQuery}
                                    aria-label="Search templates"
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div className="flex gap-1">
                                {(['all', 'market', 'analysis', 'research'] as const).map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setSelectedCategory(cat)}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${selectedCategory === cat
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                            }`}
                                    >
                                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Templates Grid */}
                    <div className="flex-1 min-h-0 p-4 overflow-y-auto">
                        <div className="grid grid-cols-2 gap-3">
                            {filteredTemplates.map(template => (
                                <button
                                    key={template.id}
                                    onClick={() => handleApplyTemplate(template)}
                                    className="group flex flex-col p-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-accent)] transition-all text-left"
                                >
                                    {/* Icon */}
                                    <div
                                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                                        style={{ backgroundColor: `${template.color}20`, color: template.color }}
                                    >
                                        {template.icon}
                                    </div>

                                    {/* Content */}
                                    <h3 className="text-sm font-medium text-[var(--text-primary)] group-hover:text-blue-400 transition-colors">
                                        {template.name}
                                    </h3>
                                    <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                                        {template.description}
                                    </p>

                                    {/* Widget count */}
                                    <div className="mt-3 flex items-center gap-1.5">
                                        <Layout size={12} className="text-[var(--text-muted)]" />
                                        <span className="text-[10px] text-[var(--text-muted)]">
                                            {template.widgets.length} widgets
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {filteredTemplates.length === 0 && (
                            <div className="text-center py-8">
                                <p className="text-[var(--text-muted)] text-sm">No templates found</p>
                            </div>
                        )}
                    </div>
                </div>
</div>
    );
}
