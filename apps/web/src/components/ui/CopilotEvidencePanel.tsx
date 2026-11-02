'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, ExternalLink, Plus } from 'lucide-react';

import type { CopilotSourceRef } from '@/lib/api';
import { submitCopilotOutcome, type CopilotResponseMeta } from '@/lib/api';
import { getCopilotSourceLabel } from '@/lib/copilotSourceLabel';
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
  showWorkflowActions?: boolean;
  className?: string;
}

function isResolvableReference(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatSourceMeta(source: CopilotSourceRef): string {
  const parts: string[] = [];
  parts.push(getCopilotSourceLabel(source.source));
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
  showWorkflowActions = true,
  className,
}: CopilotEvidencePanelProps) {
  const { state, activeDashboard, activeTab, addWidget, setActiveDashboard, setActiveTab } = useDashboard();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const orderedSources = useMemo(
    () => [...sources].sort((left, right) => (left.priority ?? 999) - (right.priority ?? 999)),
    [sources],
  );
  // "Source reference checked" is claimed only for sources the server actually
  // resolved in this response (`referenceChecked`). A syntactically valid URL is
  // not proof of a check; sources without the flag are listed, not verified.
  const checkedReferenceCount = useMemo(
    () => orderedSources.filter((source) => source.referenceChecked === true).length,
    [orderedSources],
  );
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
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
  const sourceUrl = useMemo(() => {
    if (!isResolvableReference(selectedSource?.url)) return null;
    return new URL(selectedSource!.url!.trim()).href;
  }, [selectedSource?.url]);
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
    <div className={cn('rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-2">
          <Database size={12} className="text-[var(--text-secondary)]" />
          <span className="font-semibold uppercase tracking-wide">Evidence</span>
          <span className="text-[10px] text-[var(--text-muted)]">{orderedSources.length} validated sources</span>
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <div id={panelId} className="border-t border-[var(--border-subtle)] px-3 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {orderedSources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedSourceId(source.id)}
                className={cn(
                  'min-h-9 rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors',
                  source.id === selectedSource.id
                    ? 'border-[var(--color-accent-primary)] bg-[var(--color-state-bg)] text-[var(--color-info)]'
                    : 'border-[var(--border-strong)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                [{source.id}]
              </button>
            ))}
          </div>

          <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
            <div className="font-semibold text-[var(--text-primary)]">{selectedSource.label || selectedSource.kind || selectedSource.id}</div>
            <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">[{selectedSource.id}]</div>
            {formatSourceMeta(selectedSource) && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">{formatSourceMeta(selectedSource)}</div>
            )}
            {selectedSource.kind && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">Type: {selectedSource.kind}</div>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-9 items-center gap-1 text-[var(--color-accent-primary)] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
              >
                <ExternalLink size={11} aria-hidden="true" />
                Open source: {selectedSource.label || selectedSource.kind || selectedSource.id}
              </a>
            )}
            {intent && showWorkflowActions && (
              <div className="mt-3 flex flex-wrap gap-2">
                {existingTarget && (
                  <button
                    type="button"
                    onClick={() => { void handleJumpToWidget() }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent-primary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <ExternalLink size={11} />
                    Jump to widget
                  </button>
                )}
                {canAddWidget && (
                  <button
                    type="button"
                    onClick={() => { void handleAddWidget() }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent-primary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
