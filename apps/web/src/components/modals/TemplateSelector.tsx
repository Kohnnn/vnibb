'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { X, Activity, BarChart3, Layout, TrendingUp, Search, ChevronRight, Globe2, Sigma, Newspaper, Save, Trash2, Download, Upload, Star } from 'lucide-react';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { DASHBOARD_TEMPLATES, DASHBOARD_TEMPLATE_CATEGORIES, type DashboardTemplate, type DashboardTemplateCategory } from '@/types/dashboard-templates';
import {
  loadCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  downloadCustomTemplate,
  importCustomTemplateFromJson,
  type CustomDashboardTemplate,
} from '@/lib/customTemplates';
import { recommendTemplates, recordTemplateUse, type RecommendedTemplate } from '@/lib/templateRecommender';
import type { Dashboard } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { motion, AnimatePresence } from 'framer-motion';

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: DashboardTemplate) => void;
  /** When provided, the modal shows a "Save current dashboard as template" CTA. */
  currentDashboard?: Dashboard | null;
  /** Used to bias the recommender toward symbol-relevant templates. */
  currentSymbol?: string | null;
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

function getWidgetIconClass(widgetType: string): { tone: string; label: string } {
  // QA-v4 polish: render widget category icons + short labels in the
  // mini-preview so users can recognize a template's contents at a
  // glance without reading the badge list.
  if (widgetType.startsWith('tradingview_')) return { tone: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40', label: 'TV' };
  if (widgetType.startsWith('world_news_')) return { tone: 'bg-amber-500/20 text-amber-200 border-amber-500/40', label: 'News' };
  if (widgetType.includes('chart')) return { tone: 'bg-blue-500/20 text-blue-200 border-blue-500/40', label: 'Chart' };
  if (widgetType.includes('news') || widgetType.includes('events')) return { tone: 'bg-amber-500/20 text-amber-200 border-amber-500/40', label: 'News' };
  if (widgetType.includes('order') || widgetType.includes('intraday') || widgetType.includes('transaction')) return { tone: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40', label: 'Tape' };
  if (widgetType.includes('financial') || widgetType.includes('income') || widgetType.includes('balance') || widgetType.includes('cash_flow') || widgetType.includes('ratio')) return { tone: 'bg-violet-500/20 text-violet-200 border-violet-500/40', label: 'FS' };
  if (widgetType.includes('risk') || widgetType.includes('quant') || widgetType.includes('volume_profile') || widgetType.includes('drawdown') || widgetType.includes('sortino') || widgetType.includes('seasonality')) return { tone: 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40', label: 'Quant' };
  if (widgetType.includes('momentum') || widgetType.includes('rsi') || widgetType.includes('macd') || widgetType.includes('bollinger') || widgetType.includes('ichimoku') || widgetType.includes('fibonacci') || widgetType.includes('signal')) return { tone: 'bg-teal-500/20 text-teal-200 border-teal-500/40', label: 'TA' };
  if (widgetType.includes('heatmap') || widgetType.includes('breadth') || widgetType.includes('sector') || widgetType.includes('movers')) return { tone: 'bg-blue-500/20 text-blue-200 border-blue-500/40', label: 'Mkt' };
  if (widgetType.includes('peer') || widgetType.includes('comparison') || widgetType.includes('similar') || widgetType.includes('correlation')) return { tone: 'bg-pink-500/20 text-pink-200 border-pink-500/40', label: 'Peer' };
  if (widgetType.includes('shareholder') || widgetType.includes('officer') || widgetType.includes('foreign') || widgetType.includes('insider')) return { tone: 'bg-orange-500/20 text-orange-200 border-orange-500/40', label: 'Own' };
  return { tone: 'bg-slate-500/20 text-slate-200 border-slate-500/40', label: 'W' };
}

function TemplateLayoutPreview({ template }: { template: DashboardTemplate }) {
  const maxY = Math.max(...template.widgets.map((widget) => widget.layout.y + widget.layout.h), 1);
  const visibleWidgets = template.widgets.slice(0, 12);

  return (
    <div className={cn(
      "relative mb-3 aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 transition-all group-hover:border-blue-500/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]",
      "bg-gradient-to-br",
      CATEGORY_PREVIEW_STYLES[template.category]
    )}>
      <div className="absolute inset-0 p-2">
        {visibleWidgets.map((widget, index) => {
          const { tone, label } = getWidgetIconClass(widget.type);
          const titleText = formatWidgetType(widget.type);
          const widthPct = Math.max(8, (widget.layout.w / 24) * 100);
          const heightPct = Math.max(12, (widget.layout.h / maxY) * 100);
          const isCompact = widthPct < 18 || heightPct < 18;
          return (
            <div
              key={`${template.id}-layout-${widget.type}-${index}`}
              className={cn(
                'absolute flex items-center justify-center overflow-hidden rounded-md border shadow-sm transition-transform',
                tone
              )}
              style={{
                left: `${(widget.layout.x / 24) * 100}%`,
                top: `${(widget.layout.y / maxY) * 100}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
              title={titleText}
            >
              <span className={cn(
                'truncate text-center font-bold uppercase tracking-tight',
                isCompact ? 'text-[7px] px-1' : 'text-[9px] px-2'
              )}>
                {isCompact ? label : titleText.split(' ').slice(0, 2).join(' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TemplateSelectorComponent({ open, onClose, onSelectTemplate, currentDashboard, currentSymbol }: TemplateSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<DashboardTemplateCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [customTemplates, setCustomTemplates] = useState<CustomDashboardTemplate[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendedTemplate[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState<DashboardTemplateCategory>('market');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ enabled: open, onClose });

  useEffect(() => {
    if (!open) return;
    captureAnalyticsEvent(ANALYTICS_EVENTS.templateSelectorOpened, {
      source: 'template_selector',
    });
    setCustomTemplates(loadCustomTemplates());
    setRecommendations(recommendTemplates({ currentSymbol: currentSymbol ?? null, limit: 4 }));
  }, [open, currentSymbol]);

  const handleApplyTemplate = (template: DashboardTemplate) => {
    recordTemplateUse(template, currentSymbol ?? null);
    onSelectTemplate(template);
    onClose();
  };

  const handleSaveCurrent = () => {
    if (!currentDashboard) return;
    if (!saveName.trim()) {
      setSaveError('Please enter a name.');
      return;
    }
    try {
      const tpl = saveCustomTemplate({
        name: saveName.trim(),
        category: saveCategory,
        dashboard: currentDashboard,
      });
      setCustomTemplates(loadCustomTemplates());
      setShowSaveDialog(false);
      setSaveName('');
      setSaveError(null);
      setSaveSuccess(`Saved "${tpl.name}". It is ready under Your saved layouts.`);
      captureAnalyticsEvent(ANALYTICS_EVENTS.templateSelectorOpened, {
        source: 'custom_template_saved',
        template_id: tpl.id,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save template.');
      setSaveSuccess(null);
    }
  };

  const handleDeleteCustom = (id: string) => {
    if (!window.confirm('Delete this saved layout?')) return;
    deleteCustomTemplate(id);
    setCustomTemplates(loadCustomTemplates());
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        importCustomTemplateFromJson(text);
        setCustomTemplates(loadCustomTemplates());
        setSaveError(null);
        setSaveSuccess('Imported layout. It is ready under Your saved layouts.');
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Import failed.');
        setSaveSuccess(null);
      }
    };
    input.click();
  };

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

  const filteredCustomTemplates = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return customTemplates.filter((template) => {
      const matchesCategory = !selectedCategory || template.category === selectedCategory;
      const matchesSearch = !normalizedQuery
        || template.name.toLowerCase().includes(normalizedQuery)
        || (template.description || '').toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory, customTemplates]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 z-0 bg-slate-950/60"
        aria-label="Close template selector"
      />
      <motion.div 
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-selector-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-6xl max-h-[88vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_24px_80px_rgba(15,23,42,0.35)] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div>
            <h2 id="template-selector-title" className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tighter flex items-center gap-2">
                <Layout className="text-blue-500" size={20} />
                Dashboard Templates
            </h2>
            <p className="text-xs text-[var(--text-muted)] font-medium">Choose by workflow, included widgets, and setup requirements.</p>
          </div>
          <button
            type="button"
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
              type="button"
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
                type="button"
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
          {/* Save / Import row + Custom Templates section */}
          {currentDashboard ? (
            <div className="mb-5 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Star className="text-blue-400" size={18} />
                  <div>
                    <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">Your saved layouts</h3>
                    <p className="text-[11px] text-[var(--text-muted)]">Save the current dashboard as a reusable template, or import a JSON layout from a colleague.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleImportClick}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    <Upload size={12} />
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveDialog((v) => !v);
                      setSaveError(null);
                      setSaveSuccess(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-blue-500"
                  >
                    <Save size={12} />
                    Save current
                  </button>
                </div>
              </div>
              {showSaveDialog ? (
                <div className="mt-4 grid gap-2 rounded-xl border border-blue-500/20 bg-[var(--bg-primary)] p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
                  <input
                    autoFocus
                    type="text"
                    value={saveName}
                    onChange={(event) => setSaveName(event.target.value)}
                    placeholder="Template name"
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-400/50"
                  />
                  <select
                    value={saveCategory}
                    onChange={(event) => setSaveCategory(event.target.value as DashboardTemplateCategory)}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-400/50"
                  >
                    {DASHBOARD_TEMPLATE_CATEGORIES.map((category) => (
                      <option key={category.id} value={category.id}>{category.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleSaveCurrent}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-blue-500"
                  >
                    Save layout
                  </button>
                  {saveError ? (
                    <div className="md:col-span-3 text-[11px] text-rose-300">{saveError}</div>
                  ) : null}
                </div>
              ) : null}
              {!showSaveDialog && saveSuccess ? (
                <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] font-semibold text-blue-100">
                  {saveSuccess}
                </div>
              ) : null}
              {!showSaveDialog && saveError ? (
                <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-200">
                  {saveError}
                </div>
              ) : null}

              {filteredCustomTemplates.length > 0 ? (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredCustomTemplates.map((template) => (
                    <article
                      key={template.id}
                      className="group flex flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]/55 p-3 text-left transition-all hover:border-blue-500/30"
                    >
                      <TemplateLayoutPreview template={template} />
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-amber-200">
                          Custom
                        </span>
                        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {template.widgets.length} widgets
                        </span>
                      </div>
                      <h3 className="text-sm font-black text-[var(--text-primary)] group-hover:text-blue-400">
                        {template.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{template.description}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => downloadCustomTemplate(template)}
                          className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)] hover:border-[var(--border-color)] hover:text-[var(--text-primary)]"
                        >
                          <Download size={10} /> Export
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustom(template.id)}
                          className="inline-flex items-center gap-1 rounded border border-rose-500/30 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-rose-300 hover:bg-rose-500/10"
                        >
                          <Trash2 size={10} /> Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyTemplate(template)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-blue-500"
                        >
                          Use Layout <ChevronRight size={12} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* QA-v4: Recommended-for-you row. Surfaced above the
              category-filtered grid when not actively searching, so
              first-time users get a balanced mix and returning users
              see their recent / matching workflows pinned at the top. */}
          {recommendations.length > 0 && !searchQuery.trim() && !selectedCategory ? (
            <div className="mb-5">
              <div className="mb-3 flex items-center gap-2">
                <Star className="text-amber-400" size={14} />
                <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                  Recommended for you
                </h3>
                {currentSymbol ? (
                  <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-blue-200">
                    Context · {currentSymbol}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {recommendations.map(({ template, reason }) => {
                  const categoryLabel = DASHBOARD_TEMPLATE_CATEGORIES.find((c) => c.id === template.category)?.label || template.category;
                  return (
                    <article
                      key={`rec-${template.id}`}
                      className="group flex flex-col rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-left transition-all hover:border-amber-400/50"
                    >
                      <TemplateLayoutPreview template={template} />
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-amber-200">
                          {reason}
                        </span>
                        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {categoryLabel}
                        </span>
                      </div>
                      <h3 className="text-sm font-black text-[var(--text-primary)] group-hover:text-amber-200">
                        {template.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{template.description}</p>
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate(template)}
                        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-950 hover:bg-amber-400"
                      >
                        Use Template <ChevronRight size={12} />
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

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
                      onClick={() => handleApplyTemplate(template)}
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
