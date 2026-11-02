'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
import type { WidgetGroupId } from '@/types/widget';
import { cn } from '@/lib/utils';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { motion, AnimatePresence } from 'framer-motion';
import {
  describeStarterDisclosure,
  getStarterForTemplate,
} from '@/lib/researchStarters';
import type { ResearchStarter, StarterPromptKey } from '@/lib/researchStarters';

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: DashboardTemplate) => void;
  /**
   * Primes VniAgent with the applied starter's prompt. DashboardClient owns
   * the copilot seam (setCopilotStarterPrompt + request-id bump + openCopilot).
   */
  onStarterPromptRequest?: (promptKey: StarterPromptKey, workflow: ResearchStarter['workflow']) => void;
  /**
   * Ticker groups the dashboard produced by `onSelectTemplate` actually
   * shares. Templates seed widgets without a widgetGroup, so callers pass an
   * empty list unless they genuinely assign groups.
   */
  sharedTickerGroups?: readonly WidgetGroupId[];
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
  // Decorative category colours were retired (#199): the mini-preview uses one
  // neutral tile with an accent border, and the short label carries the
  // category. Colour never encodes category.
  const tone = 'border-[var(--border-strong)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
  if (widgetType.startsWith('tradingview_')) return { tone, label: 'TV' };
  if (widgetType.startsWith('world_news_')) return { tone, label: 'News' };
  if (widgetType.includes('chart')) return { tone, label: 'Chart' };
  if (widgetType.includes('news') || widgetType.includes('events')) return { tone, label: 'News' };
  if (widgetType.includes('order') || widgetType.includes('intraday') || widgetType.includes('transaction')) return { tone, label: 'Tape' };
  if (widgetType.includes('financial') || widgetType.includes('income') || widgetType.includes('balance') || widgetType.includes('cash_flow') || widgetType.includes('ratio')) return { tone, label: 'FS' };
  if (widgetType.includes('risk') || widgetType.includes('quant') || widgetType.includes('volume_profile') || widgetType.includes('drawdown') || widgetType.includes('sortino') || widgetType.includes('seasonality')) return { tone, label: 'Quant' };
  if (widgetType.includes('momentum') || widgetType.includes('rsi') || widgetType.includes('macd') || widgetType.includes('bollinger') || widgetType.includes('ichimoku') || widgetType.includes('fibonacci') || widgetType.includes('signal')) return { tone, label: 'TA' };
  if (widgetType.includes('heatmap') || widgetType.includes('breadth') || widgetType.includes('sector') || widgetType.includes('movers')) return { tone, label: 'Mkt' };
  if (widgetType.includes('peer') || widgetType.includes('comparison') || widgetType.includes('similar') || widgetType.includes('correlation')) return { tone, label: 'Peer' };
  if (widgetType.includes('shareholder') || widgetType.includes('officer') || widgetType.includes('foreign') || widgetType.includes('insider')) return { tone, label: 'Own' };
  return { tone, label: 'W' };
}

function getTemplateStarter(template: DashboardTemplate): ResearchStarter | undefined {
  // Custom saved layouts are keyed by their own ids and never carry a starter.
  return template.id.startsWith('custom-') ? undefined : getStarterForTemplate(template.id);
}

function getStarterDisclosure(
  starter: ResearchStarter | undefined,
  sharedTickerGroups: readonly WidgetGroupId[],
): string | null {
  return starter ? describeStarterDisclosure(starter, { sharedTickerGroups }) : null;
}

function TemplateLayoutPreview({ template }: { template: DashboardTemplate }) {
  const maxY = Math.max(...template.widgets.map((widget) => widget.layout.y + widget.layout.h), 1);
  const visibleWidgets = template.widgets.slice(0, 12);

  return (
    <div className={cn(
      "relative mb-3 aspect-video w-full overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] transition-colors group-hover:border-[var(--border-strong)]",
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

function TemplateSelectorComponent({ open, onClose, onSelectTemplate, onStarterPromptRequest, sharedTickerGroups, currentDashboard, currentSymbol }: TemplateSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<DashboardTemplateCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [customTemplates, setCustomTemplates] = useState<CustomDashboardTemplate[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendedTemplate[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState<DashboardTemplateCategory>('market');
  const [saveError, setSaveError] = useState<string | null>(null);
  // Discloses what applying a starter-bound template does the moment the user
  // asks for it, so the consequence is read before the workspace is replaced.
  const [pendingStarter, setPendingStarter] = useState<{ template: DashboardTemplate; starter: ResearchStarter; disclosure: string } | null>(null);
  const [appliedStarter, setAppliedStarter] = useState<ResearchStarter | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const starterTriggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ enabled: open && !pendingStarter, onClose });
  const starterDialogRef = useDialogFocusTrap<HTMLDivElement>({ enabled: open && Boolean(pendingStarter), onClose: () => setPendingStarter(null) });

  useEffect(() => {
    if (pendingStarter || !open || !starterTriggerRef.current) return;
    const trigger = starterTriggerRef.current;
    starterTriggerRef.current = null;
    const timeout = window.setTimeout(() => trigger.isConnected && trigger.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [pendingStarter, open]);

  useEffect(() => {
    if (!open) return;
    captureAnalyticsEvent(ANALYTICS_EVENTS.templateSelectorOpened, {
      source: 'template_selector',
    });
    setCustomTemplates(loadCustomTemplates());
    setRecommendations(recommendTemplates({ currentSymbol: currentSymbol ?? null, limit: 4 }));
    // Stale confirmations must not survive a close/reopen of the modal.
    setPendingStarter(null);
    setAppliedStarter(null);
  }, [open, currentSymbol]);

  const applyTemplate = (template: DashboardTemplate, starter: ResearchStarter | undefined) => {
    recordTemplateUse(template, currentSymbol ?? null);
    onSelectTemplate(template);
    if (starter) {
      setAppliedStarter(starter);
      onStarterPromptRequest?.(starter.promptKey, starter.workflow);
    }
    onClose();
  };

  const handleApplyTemplate = (template: DashboardTemplate) => {
    const starter = getTemplateStarter(template);
    if (!starter) {
      applyTemplate(template, undefined);
      return;
    }
    starterTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingStarter({
      template,
      starter,
      disclosure: getStarterDisclosure(starter, sharedTickerGroups ?? []) as string,
    });
  };

  const handleConfirmStarter = () => {
    if (!pendingStarter) return;
    setPendingStarter(null);
    applyTemplate(pendingStarter.template, pendingStarter.starter);
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
    try {
      deleteCustomTemplate(id);
      setCustomTemplates(loadCustomTemplates());
      setSaveSuccess('Saved layout deleted.');
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not delete saved layout.');
      setSaveSuccess(null);
    }
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
        className="absolute inset-0 z-0 bg-[rgb(2_6_23_/_0.72)]"
        aria-label="Close template selector"
      />
      <motion.div 
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal={!pendingStarter}
        aria-labelledby="template-selector-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-6xl max-h-[88vh] bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-md shadow-lg overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div>
            <h2 id="template-selector-title" className="text-xl font-bold text-[var(--text-primary)] uppercase tracking-tighter flex items-center gap-2">
                <Layout className="text-[var(--color-accent-primary)]" size={20} />
                Dashboard Templates
            </h2>
            <p className="text-xs text-[var(--text-muted)] font-medium">Choose by workflow, included widgets, and setup requirements.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close template selector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Applied confirmation: the starter's purpose and its real ticker-group
            consequence stay visible in the modal that launched it. */}
        {appliedStarter ? (
          <div className="border-b border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-info)]">
              Starter applied · {appliedStarter.name}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-[var(--text-primary)]">
              {getStarterDisclosure(appliedStarter, sharedTickerGroups ?? [])}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              VniAgent is primed with this starter&apos;s prompt for {appliedStarter.name.toLowerCase()}.
            </p>
          </div>
        ) : null}

        {/* Category Filter */}
        <div className="space-y-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/70 p-4">
          <div className="relative max-w-xl">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search templates or included widgets..."
              className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={cn(
                  "rounded-md border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]",
                  !selectedCategory
                    ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] text-white'
                    : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
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
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]",
                  selectedCategory === category.id
                    ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] text-white'
                    : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
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
            <div className="mb-5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Star className="text-[var(--color-accent-primary)]" size={18} />
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-tight">Your saved layouts</h3>
                    <p className="text-[11px] text-[var(--text-muted)]">Saved on this device. Export a saved layout to back it up or import it on another browser.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleImportClick}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
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
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-[var(--color-accent-hover)]"
                  >
                    <Save size={12} />
                    Save current
                  </button>
                </div>
              </div>
              {showSaveDialog ? (
                <div className="mt-4 grid gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-primary)] p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
                  <input
                    autoFocus
                    type="text"
                    value={saveName}
                    onChange={(event) => setSaveName(event.target.value)}
                    placeholder="Template name"
                    className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
                  />
                  <select
                    value={saveCategory}
                    onChange={(event) => setSaveCategory(event.target.value as DashboardTemplateCategory)}
                    className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
                  >
                    {DASHBOARD_TEMPLATE_CATEGORIES.map((category) => (
                      <option key={category.id} value={category.id}>{category.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleSaveCurrent}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--color-accent-hover)]"
                  >
                    Save layout
                  </button>
                  {saveError ? (
                    <div className="md:col-span-3 text-[11px] text-[var(--color-error)]">{saveError}</div>
                  ) : null}
                </div>
              ) : null}
              {!showSaveDialog && saveSuccess ? (
                <div className="mt-3 rounded-md border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-3 py-2 text-[11px] font-semibold text-[var(--color-info)]">
                  {saveSuccess}
                </div>
              ) : null}
              {!showSaveDialog && saveError ? (
                <div className="mt-3 rounded-md border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-3 py-2 text-[11px] font-semibold text-[var(--color-error)]">
                  {saveError}
                </div>
              ) : null}

              {filteredCustomTemplates.length > 0 ? (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredCustomTemplates.map((template) => (
                    <article
                      key={template.id}
                      className="group flex flex-col rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
                    >
                      <TemplateLayoutPreview template={template} />
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-info)]">
                          Custom
                        </span>
                        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {template.widgets.length} widgets
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--color-accent-primary)]">
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
                          className="inline-flex items-center gap-1 rounded border border-[var(--border-strong)] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <Trash2 size={10} /> Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyTemplate(template)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--color-accent-hover)]"
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
                <Star className="text-[var(--color-accent-primary)]" size={14} />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                  Recommended for you
                </h3>
                {currentSymbol ? (
                  <span className="rounded-full border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--color-info)]">
                    Context · {currentSymbol}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {recommendations.map(({ template, reason }) => {
                  const categoryLabel = DASHBOARD_TEMPLATE_CATEGORIES.find((c) => c.id === template.category)?.label || template.category;
                  const starter = getTemplateStarter(template);
                  return (
                    <article
                      key={`rec-${template.id}`}
                      className="group flex flex-col rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
                    >
                      <TemplateLayoutPreview template={template} />
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-info)]">
                          {reason}
                        </span>
                        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {categoryLabel}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--color-accent-primary)]">
                        {template.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{template.description}</p>
                      {starter ? (
                        <p className="mt-2 text-[11px] font-semibold leading-relaxed text-[var(--text-secondary)]">{starter.purpose}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate(template)}
                        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--color-accent-hover)]"
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
              const starter = getTemplateStarter(template);
              return (
                <article
                  key={template.id}
                  className="group flex flex-col rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-secondary)]"
                >
                  <TemplateLayoutPreview template={template} />

                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                      {categoryLabel}
                    </span>
                    {getTemplateBadges(template).map((badge) => (
                      <span key={badge} className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        {badge}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] transition-colors group-hover:text-[var(--color-accent-primary)]">{template.name}</h3>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    {template.description}
                  </p>
                  {starter ? (
                    <p className="mt-2 text-[11px] font-semibold leading-relaxed text-[var(--text-secondary)]">
                      {starter.purpose}
                    </p>
                  ) : null}

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
                      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-[var(--color-accent-hover)]"
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

      {/* Pre-apply disclosure: shown before the current workspace is replaced. */}
      <AnimatePresence>
        {pendingStarter ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-[rgb(2_6_23_/_0.72)] p-4"
          >
            <div
              ref={starterDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="starter-disclosure-title"
              className="w-full max-w-lg rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-lg"
            >
              <h3
                id="starter-disclosure-title"
                className="text-sm font-bold uppercase tracking-tight text-[var(--text-primary)]"
              >
                {pendingStarter.starter.name}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                {pendingStarter.starter.purpose}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
                {pendingStarter.disclosure}
              </p>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">Current symbol: {currentSymbol || 'not selected'}</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingStarter(null)}
                  className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmStarter}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-[var(--color-accent-hover)]"
                >
                  Apply {pendingStarter.template.name}
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const TemplateSelector = memo(TemplateSelectorComponent);
export default TemplateSelector;
