'use client';

import { memo, useMemo, useState } from 'react';
import { X, Activity, BarChart3, Layout, TrendingUp, Search, ChevronRight, Globe2, Sigma, Newspaper } from 'lucide-react';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
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

function TemplateSelectorComponent({ open, onClose, onSelectTemplate }: TemplateSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<DashboardTemplateCategory | null>(null);

  const categoryCounts = useMemo(() => {
    return Object.fromEntries(
      DASHBOARD_TEMPLATE_CATEGORIES.map((category) => [
        category.id,
        DASHBOARD_TEMPLATES.filter((template) => template.category === category.id).length,
      ])
    ) as Record<DashboardTemplateCategory, number>;
  }, []);

  const filteredTemplates = selectedCategory
    ? DASHBOARD_TEMPLATES.filter(t => t.category === selectedCategory)
    : DASHBOARD_TEMPLATES;

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
        className="w-full max-w-4xl max-h-[85vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_24px_80px_rgba(15,23,42,0.35)] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tighter flex items-center gap-2">
                <Layout className="text-blue-500" size={20} />
                Dashboard Templates
            </h2>
            <p className="text-xs text-[var(--text-muted)] font-medium">Quickly setup your workspace with professional layouts</p>
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
        <div className="flex gap-2 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/70 p-4">
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

        {/* Templates Grid */}
        <div className="flex-1 p-6 overflow-y-auto scrollbar-hide bg-[var(--bg-primary)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => {
                  onSelectTemplate(template);
                  onClose();
                }}
                className="group flex flex-col rounded-xl border border-transparent bg-[var(--bg-surface)]/45 p-2 text-left transition-all duration-300 hover:border-blue-500/20 hover:bg-[var(--bg-surface)]/70 focus:outline-none"
              >
                <div className={cn(
                  "relative mb-3 aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 group-hover:border-blue-500/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] transition-all",
                  "bg-gradient-to-br",
                  CATEGORY_PREVIEW_STYLES[template.category]
                )}>
                  <div className="absolute inset-0 p-3 flex flex-col justify-between">
                    <div className="grid grid-cols-3 gap-1.5">
                      {template.widgets.slice(0, 4).map((widget, idx) => (
                        <div
                          key={`${template.id}-preview-top-${idx}`}
                          className="h-5 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/85"
                        />
                      ))}
                    </div>
                    <div className="space-y-1">
                      {template.widgets.slice(0, 4).map((widget, idx) => (
                        <div
                          key={`${template.id}-preview-label-${idx}`}
                          className="inline-flex items-center mr-1 mb-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-1.5 py-0.5"
                        >
                          <span className="text-[8px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
                            {formatWidgetType(widget.type)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors flex items-center justify-center">
                    <div className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all">
                      Apply Template
                    </div>
                  </div>
                </div>
                
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-blue-500/15 bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-blue-200/90">
                    {DASHBOARD_TEMPLATE_CATEGORIES.find((category) => category.id === template.category)?.label || template.category}
                  </span>
                </div>
                <h3 className="font-bold text-[var(--text-primary)] text-sm group-hover:text-blue-400 transition-colors">{template.name}</h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
                    {template.description}
                </p>
                
                <div className="mt-auto pt-3 flex items-center justify-between border-t border-[var(--border-default)]/70">
                    <span className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-tighter">
                      {template.widgets.length} widgets
                    </span>
                    <ChevronRight size={14} className="text-[var(--text-muted)] group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export const TemplateSelector = memo(TemplateSelectorComponent);
export default TemplateSelector;
