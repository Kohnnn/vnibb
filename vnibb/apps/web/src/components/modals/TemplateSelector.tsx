'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { X, Activity, BarChart3, Layout, TrendingUp, Search, ChevronRight, Globe2, Sigma, Newspaper } from 'lucide-react';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { DASHBOARD_TEMPLATES, DASHBOARD_TEMPLATE_CATEGORIES, type DashboardTemplate, type DashboardTemplateCategory } from '@/types/dashboard-templates';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: DashboardTemplate) => void;
}

const CATEGORY_ICONS: Record<DashboardTemplateCategory, any> = {
  market: Activity,
  fundamentals: BarChart3,
  technical: TrendingUp,
  quant: Sigma,
  research: Newspaper,
  global: Globe2,
};

const CATEGORY_PREVIEW_STYLES: Record<DashboardTemplateCategory, string> = {
  market: 'from-blue-500/15 via-cyan-500/5 to-emerald-500/10',
  fundamentals: 'from-amber-500/15 via-orange-500/5 to-yellow-500/10',
  technical: 'from-emerald-500/15 via-teal-500/5 to-cyan-500/10',
  quant: 'from-fuchsia-500/15 via-violet-500/5 to-cyan-500/10',
  research: 'from-slate-200/10 via-slate-400/5 to-blue-500/10',
  global: 'from-violet-500/15 via-fuchsia-500/5 to-cyan-500/10',
};

function formatWidgetType(type: string) {
  return getWidgetDefinition(type)?.name || type
    .split('_')
    .map(chunk => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function getTemplateIntent(template: DashboardTemplate) {
  if (template.id === 'world-monitor') return 'Global risk monitoring';
  if (template.id === 'global-markets') return 'Cross-market context';
  if (template.category === 'fundamentals') return 'Long-horizon research';
  if (template.category === 'technical') return 'Trading workflow';
  if (template.category === 'quant') return 'Signal research';
  if (template.category === 'research') return 'Investigation workflow';
  return 'Market monitoring';
}

function getTemplateBadges(template: DashboardTemplate) {
  const badges = [getTemplateIntent(template), `${template.widgets.length} widgets`];
  if (template.widgets.some((widget) => widget.type.startsWith('world_news_'))) {
    badges.push('Live RSS');
  }
  if (template.widgets.some((widget) => widget.type.startsWith('tradingview_'))) {
    badges.push('TradingView');
  }
  if (template.id === 'world-monitor' || template.id === 'global-markets') {
    badges.push('No symbol required');
  }
  return badges.slice(0, 4);
}

function TemplateLayoutPreview({ template }: { template: DashboardTemplate }) {
  const maxY = Math.max(...template.widgets.map((widget) => widget.layout.y + widget.layout.h), 1);
  const visibleWidgets = template.widgets.slice(0, 8);

  return (
    <div className={cn(
      "relative mb-3 aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 transition-all group-hover:border-blue-500/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]",
      "bg-gradient-to-br",
      CATEGORY_PREVIEW_STYLES[template.category]
    )}>
      <div className="absolute inset-0 p-3">
        {visibleWidgets.map((widget, index) => (
          <div
            key={`${template.id}-layout-${widget.type}-${index}`}
            className="absolute rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/85 shadow-sm"
            style={{
              left: `${(widget.layout.x / 24) * 100}%`,
              top: `${(widget.layout.y / maxY) * 100}%`,
              width: `${Math.max(8, (widget.layout.w / 24) * 100)}%`,
              height: `${Math.max(12, (widget.layout.h / maxY) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
        {template.widgets.slice(0, 4).map((widget) => (
          <span
            key={`${template.id}-${widget.type}`}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[var(--text-secondary)]"
          >
            {formatWidgetType(widget.type)}
          </span>
        ))}
      </div>
    </div>
  );
}

function TemplateSelectorComponent({ open, onClose, onSelectTemplate }: TemplateSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<DashboardTemplateCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!open) return
    captureAnalyticsEvent(ANALYTICS_EVENTS.templateSelectorOpened, {
      source: 'template_selector',
    })
  }, [open])

  const categoryCounts = useMemo(() => {
    return Object.fromEntries(
      DASHBOARD_TEMPLATE_CATEGORIES.map((category) => [
        category.id,
        DASHBOARD_TEMPLATES.filter((template) => template.category === category.id).length,
      ])
    ) as Record<DashboardTemplateCategory, number>;
  }, []);

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return DASHBOARD_TEMPLATES.filter((template) => {
      const matchesCategory = !selectedCategory || template.category === selectedCategory;
      const matchesSearch = !normalizedQuery
        || template.name.toLowerCase().includes(normalizedQuery)
        || template.description.toLowerCase().includes(normalizedQuery)
        || template.widgets.some((widget) => formatWidgetType(widget.type).toLowerCase().includes(normalizedQuery));

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/60"
        aria-label="Close template selector"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-6xl max-h-[88vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_24px_80px_rgba(15,23,42,0.35)] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tighter flex items-center gap-2">
                <Layout className="text-blue-500" size={20} />
                Dashboard Templates
            </h2>
            <p className="text-xs text-[var(--text-muted)] font-medium">Choose by workflow, included widgets, and setup requirements.</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-hover)] rounded-full transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-label="Close template selector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Filter */}
        <div className="space-y-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/70 p-4">
          <div className="relative max-w-xl">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search templates or included widgets..."
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-all focus:border-blue-500/50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={cn(
                  "rounded-lg border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all",
                  !selectedCategory
                    ? 'border-blue-400/50 bg-blue-600 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.24)]'
                    : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-blue-500/30'
              )}
            >
              All Templates
            </button>
            {DASHBOARD_TEMPLATE_CATEGORIES.map((category) => {
              const Icon = CATEGORY_ICONS[category.id]
              return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all",
                  selectedCategory === category.id
                    ? 'border-blue-400/50 bg-blue-600 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.24)]'
                    : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-blue-500/30'
                )}
              >
                <Icon className="w-3 h-3" />
                {category.label}
                <span className="text-[9px] opacity-75">{categoryCounts[category.id]}</span>
              </button>
              )
            })}
          </div>
        </div>

        {/* Templates Grid */}
        <div className="flex-1 p-6 overflow-y-auto scrollbar-hide bg-[var(--bg-primary)]">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filteredTemplates.map(template => {
              const categoryLabel = DASHBOARD_TEMPLATE_CATEGORIES.find((category) => category.id === template.category)?.label || template.category;
              return (
                <article
                  key={template.id}
                  className="group flex flex-col rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]/55 p-3 text-left transition-all duration-300 hover:border-blue-500/30 hover:bg-[var(--bg-surface)]/80"
                >
                  <TemplateLayoutPreview template={template} />

                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-full border border-blue-500/15 bg-blue-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-blue-200/90">
                      {categoryLabel}
                    </span>
                    {getTemplateBadges(template).map((badge) => (
                      <span key={badge} className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        {badge}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-sm font-black text-[var(--text-primary)] transition-colors group-hover:text-blue-400">{template.name}</h3>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    {template.description}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {template.widgets.slice(0, 5).map((widget) => (
                      <span key={`${template.id}-included-${widget.type}`} className="rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[var(--text-secondary)]">
                        {formatWidgetType(widget.type)}
                      </span>
                    ))}
                    {template.widgets.length > 5 && (
                      <span className="rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[var(--text-muted)]">
                        +{template.widgets.length - 5} more
                      </span>
                    )}
                  </div>

                  <div className="mt-auto pt-4 flex items-center justify-between gap-3">
                    <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Ready layout
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTemplate(template);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-blue-500"
                    >
                      Use Template
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">
              No templates match your filters.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export const TemplateSelector = memo(TemplateSelectorComponent);
export default TemplateSelector;
