'use client';

import { memo, useState } from 'react';
import { X, Layout, TrendingUp, Search, Newspaper, ChevronRight } from 'lucide-react';
import { DASHBOARD_TEMPLATES, DashboardTemplate } from '@/types/dashboard-templates';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: DashboardTemplate) => void;
}

const CATEGORY_ICONS: Record<string, any> = {
  trading: TrendingUp,
  analysis: Search,
  research: Layout,
  overview: Newspaper,
};

const CATEGORY_PREVIEW_STYLES: Record<string, string> = {
  trading: 'from-emerald-500/15 via-emerald-500/5 to-cyan-500/10',
  analysis: 'from-sky-500/15 via-blue-500/5 to-cyan-500/10',
  research: 'from-amber-500/15 via-orange-500/5 to-yellow-500/10',
  overview: 'from-blue-500/15 via-indigo-500/5 to-cyan-500/10',
};

function formatWidgetType(type: string) {
  return type
    .split('_')
    .map(chunk => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function TemplateSelectorComponent({ open, onClose, onSelectTemplate }: TemplateSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (!open) return null;

  const filteredTemplates = selectedCategory
    ? DASHBOARD_TEMPLATES.filter(t => t.category === selectedCategory)
    : DASHBOARD_TEMPLATES;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-4xl max-h-[85vh] bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
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
        <div className="flex gap-2 p-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/70">
          <button
            onClick={() => setSelectedCategory(null)}
            className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                !selectedCategory ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-secondary)]'
            )}
          >
            All Templates
          </button>
          {Object.entries(CATEGORY_ICONS).map(([cat, Icon]) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                selectedCategory === cat ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-secondary)]'
              )}
            >
              <Icon className="w-3 h-3" />
              {cat}
            </button>
          ))}
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
                className="group flex flex-col text-left transition-all duration-300 focus:outline-none"
              >
                <div className={cn(
                  "aspect-video w-full mb-3 rounded-xl border border-[var(--border-default)] relative overflow-hidden group-hover:border-blue-500/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] transition-all",
                  "bg-gradient-to-br",
                  CATEGORY_PREVIEW_STYLES[template.category] || CATEGORY_PREVIEW_STYLES.overview
                )}>
                  <div className="absolute inset-0 p-3 flex flex-col justify-between">
                    <div className="grid grid-cols-3 gap-1.5">
                      {template.widgets.slice(0, 3).map((widget, idx) => (
                        <div
                          key={`${template.id}-preview-top-${idx}`}
                          className="h-5 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]/85"
                        />
                      ))}
                    </div>
                    <div className="space-y-1">
                      {template.widgets.slice(0, 3).map((widget, idx) => (
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
                
                <h3 className="font-bold text-[var(--text-primary)] text-sm group-hover:text-blue-400 transition-colors">{template.name}</h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
                    {template.description}
                </p>
                
                <div className="mt-auto pt-3 flex items-center justify-between border-t border-[var(--border-default)]/70">
                    <span className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-tighter">
                      {template.widgets.length} Components
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
