'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, ExternalLink, Plus } from 'lucide-react';

import type { CopilotSourceRef } from '@/lib/api';
import { submitCopilotOutcome, type CopilotResponseMeta } from '@/lib/api';
import { useDashboard } from '@/contexts/DashboardContext';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import {
  findMatchingWidgetTarget,
  focusDashboardWidget,
  getIntentFromSource,
} from '@/lib/vniagentWorkspace';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { cn } from '@/lib/utils';
import type { WidgetCreate } from '@/types/dashboard';

interface CopilotEvidencePanelProps {
  sources: CopilotSourceRef[];
  responseMeta?: CopilotResponseMeta;
  surface?: 'sidebar' | 'widget' | 'analysis';
  className?: string;
}

function formatSourceMeta(source: CopilotSourceRef): string {
  const parts: string[] = [];
  if (source.source) {
    parts.push(source.source);
  }
  if (source.symbol) {
    parts.push(source.symbol);
  }
  if (source.asOf) {
    parts.push(`as of ${source.asOf}`);
  }
  return parts.join(' · ');
}

export function CopilotEvidencePanel({
  sources,
  responseMeta,
  surface = 'sidebar',
  className,
}: CopilotEvidencePanelProps) {
  const { state, activeDashboard, activeTab, addWidget, setActiveDashboard, setActiveTab } = useDashboard();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const orderedSources = useMemo(
    () => [...sources].sort((left, right) => (left.priority ?? 999) - (right.priority ?? 999)),
    [sources],
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(orderedSources[0]?.id ?? null);

  useEffect(() => {
    if (!orderedSources.length) {
      setSelectedSourceId(null);
      return;
    }
    if (!selectedSourceId || !orderedSources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(orderedSources[0].id);
    }
  }, [orderedSources, selectedSourceId]);

  const selectedSource = orderedSources.find((source) => source.id === selectedSourceId) ?? orderedSources[0] ?? null;
  const intent = useMemo(() => (selectedSource ? getIntentFromSource(selectedSource) : null), [selectedSource]);
  const existingTarget = useMemo(
    () => (intent ? findMatchingWidgetTarget(state, intent) : null),
    [intent, state],
  );
  const canAddWidget = Boolean(intent && activeDashboard && activeTab && ((activeDashboard.adminUnlocked === true) || activeDashboard.isEditable !== false));

  if (!orderedSources.length) {
    return null;
  }

  if (!selectedSource) {
    return null;
  }

  const recordOutcome = async (status: 'shown' | 'executed' | 'failed', notes?: string) => {
    if (!responseMeta?.responseId || !selectedSource) return;
    try {
      await submitCopilotOutcome({
        responseId: responseMeta.responseId,
        kind: 'artifact',
        itemId: selectedSource.id,
        status,
        surface,
        notes,
      });
    } catch {
      // Ignore telemetry failures in UI.
    }
  };

  const handleJumpToWidget = async () => {
    if (!existingTarget) return;
    if (intent?.symbol && globalSymbol !== intent.symbol) {
      setGlobalSymbol(intent.symbol);
    }
    focusDashboardWidget(existingTarget, setActiveDashboard, setActiveTab);
    await recordOutcome('executed', 'Jumped to source-linked widget');
  };

  const handleAddWidget = async () => {
    if (!intent || !activeDashboard || !activeTab) return;
    const defaultLayout = getWidgetDefaultLayout(intent.widgetType);
    const widgetConfig = intent.config || {};
    const widgetCreate: WidgetCreate = {
      type: intent.widgetType,
      tabId: activeTab.id,
      config: widgetConfig,
      layout: {
        x: 0,
        y: Infinity,
        w: defaultLayout.w,
        h: defaultLayout.h,
        minW: defaultLayout.minW,
        minH: defaultLayout.minH,
        maxW: defaultLayout.maxW,
        maxH: defaultLayout.maxH,
      },
    };
    addWidget(activeDashboard.id, activeTab.id, widgetCreate)
    await recordOutcome('executed', `Added ${intent.label} from evidence source`)
  };

  return (
    <div className={cn('rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-2">
          <Database size={12} className="text-blue-400" />
          <span className="font-semibold uppercase tracking-wide">Evidence</span>
          <span className="text-[10px] text-[var(--text-muted)]">{orderedSources.length} validated sources</span>
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {orderedSources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedSourceId(source.id)}
                className={cn(
                  'rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors',
                  source.id === selectedSource.id
                    ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                    : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                [{source.id}]
              </button>
            ))}
          </div>

          <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
            <div className="font-semibold text-[var(--text-primary)]">{selectedSource.label || selectedSource.kind || selectedSource.id}</div>
            <div className="mt-1 font-mono text-[10px] text-blue-300">[{selectedSource.id}]</div>
            {formatSourceMeta(selectedSource) && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">{formatSourceMeta(selectedSource)}</div>
            )}
            {selectedSource.kind && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">Type: {selectedSource.kind}</div>
            )}
            {intent && (
              <div className="mt-3 flex flex-wrap gap-2">
                {existingTarget && (
                  <button
                    type="button"
                    onClick={() => { void handleJumpToWidget() }}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
                  >
                    <ExternalLink size={11} />
                    Jump to widget
                  </button>
                )}
                {canAddWidget && (
                  <button
                    type="button"
                    onClick={() => { void handleAddWidget() }}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:bg-blue-500/20"
                  >
                    <Plus size={11} />
                    Add widget
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CopilotEvidencePanel
