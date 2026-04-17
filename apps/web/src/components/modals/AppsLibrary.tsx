'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    BarChart3,
    Globe,
    Layout,
    Newspaper,
    Search,
    Sigma,
    TrendingUp,
    X,
} from 'lucide-react';

import { useDashboard } from '@/contexts/DashboardContext';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
    DASHBOARD_TEMPLATES,
    DASHBOARD_TEMPLATE_CATEGORIES,
    type DashboardTemplate,
    type DashboardTemplateCategory,
} from '@/types/dashboard-templates';

interface AppsLibraryProps {
    isOpen: boolean;
    onClose: () => void;
}

const CATEGORY_ICONS: Record<DashboardTemplateCategory, typeof Activity> = {
    market: Activity,
    fundamentals: BarChart3,
    technical: TrendingUp,
    quant: Sigma,
    research: Newspaper,
    global: Globe,
};

const CATEGORY_STYLES: Record<DashboardTemplateCategory, string> = {
    market: 'from-blue-500/15 via-cyan-500/5 to-emerald-500/10',
    fundamentals: 'from-amber-500/15 via-orange-500/5 to-yellow-500/10',
    technical: 'from-emerald-500/15 via-teal-500/5 to-cyan-500/10',
    quant: 'from-fuchsia-500/15 via-violet-500/5 to-cyan-500/10',
    research: 'from-slate-200/10 via-slate-400/5 to-blue-500/10',
    global: 'from-violet-500/15 via-fuchsia-500/5 to-cyan-500/10',
};

function getTemplateWidgetLabel(type: string): string {
    return getWidgetDefinition(type)?.name || type.replace(/_/g, ' ');
}

export function AppsLibrary({ isOpen, onClose }: AppsLibraryProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<DashboardTemplateCategory | 'all'>('all');
    const { createDashboard, addWidget, setActiveDashboard } = useDashboard();

    const filteredTemplates = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        return DASHBOARD_TEMPLATES.filter((template) => {
            const matchesSearch = !normalizedQuery
                || template.name.toLowerCase().includes(normalizedQuery)
                || template.description.toLowerCase().includes(normalizedQuery)
                || template.widgets.some((widget) => getTemplateWidgetLabel(widget.type).toLowerCase().includes(normalizedQuery));
            const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    }, [searchQuery, selectedCategory]);

    const categoryCounts = useMemo(() => {
        return Object.fromEntries(
            DASHBOARD_TEMPLATE_CATEGORIES.map((category) => [
                category.id,
                DASHBOARD_TEMPLATES.filter((template) => template.category === category.id).length,
            ])
        ) as Record<DashboardTemplateCategory, number>;
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        captureAnalyticsEvent(ANALYTICS_EVENTS.appsLibraryOpened, {
            source: 'apps_library',
        });
    }, [isOpen]);

    if (!isOpen) return null;

    const handleApplyTemplate = (template: DashboardTemplate) => {
        const dashboard = createDashboard({
            name: template.name,
            folderId: template.category === 'global' ? 'folder-initial' : undefined,
        });

        const tabId = dashboard.tabs[0]?.id;
        if (tabId) {
            template.widgets.forEach((widget) => {
                addWidget(dashboard.id, tabId, {
                    type: widget.type,
                    tabId,
                    config: widget.config || {},
                    layout: widget.layout || getWidgetDefaultLayout(widget.type),
                });
            });
        }

        setActiveDashboard(dashboard.id);
        captureAnalyticsEvent(ANALYTICS_EVENTS.workspaceTemplateApplied, {
            source: 'apps_library',
            template_id: template.id,
            template_name: template.name,
            template_category: template.category,
            dashboard_id: dashboard.id,
            widget_count: template.widgets.length,
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
                className="absolute inset-0 bg-slate-950/60"
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

            <div className="relative flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-5 py-4">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                            <Layout size={18} className="text-blue-500" />
                            Workspace Templates
                        </h2>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Launch curated workspaces from one canonical template library.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        aria-label="Close apps library"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="border-b border-[var(--border-default)] bg-[var(--bg-surface)]/70 px-4 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input
                                type="text"
                                placeholder="Search templates or widget names..."
                                value={searchQuery}
                                aria-label="Search templates"
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-500/50"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setSelectedCategory('all')}
                                className={cn(
                                    'rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all',
                                    selectedCategory === 'all'
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                        : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                )}
                            >
                                All Templates
                            </button>
                            {DASHBOARD_TEMPLATE_CATEGORIES.map((category) => {
                                const Icon = CATEGORY_ICONS[category.id];
                                return (
                                    <button
                                        key={category.id}
                                        onClick={() => setSelectedCategory(category.id)}
                                        className={cn(
                                            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all',
                                            selectedCategory === category.id
                                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                        )}
                                    >
                                        <Icon size={12} />
                                        {category.label}
                                        <span className="text-[9px] opacity-75">{categoryCounts[category.id]}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)] p-5">
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        {filteredTemplates.map((template) => (
                            <button
                                key={template.id}
                                onClick={() => handleApplyTemplate(template)}
                                className="group flex flex-col rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-left transition-all hover:border-blue-500/40 hover:bg-[var(--bg-hover)]"
                            >
                                <div
                                    className={cn(
                                        'relative mb-4 aspect-[16/8] overflow-hidden rounded-xl border border-[var(--border-default)] bg-gradient-to-br',
                                        CATEGORY_STYLES[template.category]
                                    )}
                                >
                                    <div className="absolute inset-0 p-3">
                                        <div className="grid grid-cols-3 gap-2">
                                            {template.widgets.slice(0, 3).map((widget, index) => (
                                                <div
                                                    key={`${template.id}-box-${index}`}
                                                    className="h-6 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/85"
                                                />
                                            ))}
                                        </div>
                                        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
                                            {template.widgets.slice(0, 4).map((widget) => (
                                                <span
                                                    key={`${template.id}-${widget.type}`}
                                                    className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--text-secondary)]"
                                                >
                                                    {getTemplateWidgetLabel(widget.type)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-2 flex items-center gap-2">
                                    <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                        {DASHBOARD_TEMPLATE_CATEGORIES.find((category) => category.id === template.category)?.label || template.category}
                                    </span>
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                        {template.widgets.length} widgets
                                    </span>
                                </div>

                                <h3 className="text-sm font-bold text-[var(--text-primary)] transition-colors group-hover:text-blue-400">
                                    {template.name}
                                </h3>
                                <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                                    {template.description}
                                </p>
                            </button>
                        ))}
                    </div>

                    {filteredTemplates.length === 0 && (
                        <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                            No templates match this search.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
