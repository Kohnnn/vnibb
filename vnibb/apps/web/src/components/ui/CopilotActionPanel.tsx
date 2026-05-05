'use client';

import { useMemo, useState } from 'react';
import { Check, Plus, RotateCcw, Sparkles, X } from 'lucide-react';

import { useDashboard } from '@/contexts/DashboardContext';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { submitCopilotOutcome, type CopilotActionSuggestion, type CopilotResponseMeta } from '@/lib/api';
import type { WidgetType } from '@/types/dashboard';

interface CopilotActionPanelProps {
  actions: CopilotActionSuggestion[];
  responseMeta?: CopilotResponseMeta;
  surface?: 'sidebar' | 'widget' | 'analysis';
}

function resolveWidgetType(action: CopilotActionSuggestion): WidgetType | null {
  const widgetType = action.payload.widgetType;
  return typeof widgetType === 'string' ? (widgetType as WidgetType) : null;
}

export function CopilotActionPanel({ actions, responseMeta, surface = 'sidebar' }: CopilotActionPanelProps) {
  const { activeDashboard, activeTab, addWidget } = useDashboard();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [executedActionIds, setExecutedActionIds] = useState<Record<string, string>>({});

  const canEditCurrentDashboard = useMemo(
    () => (activeDashboard?.adminUnlocked === true) || activeDashboard?.isEditable !== false,
    [activeDashboard?.adminUnlocked, activeDashboard?.isEditable],
  );

  if (!actions.length) {
    return null;
  }

  const recordOutcome = async (
    action: CopilotActionSuggestion,
    status: 'executed' | 'failed',
    notes?: string,
  ) => {
    if (!responseMeta?.responseId) {
      return;
    }
    try {
      await submitCopilotOutcome({
        responseId: responseMeta.responseId,
        kind: 'action',
        itemId: action.id,
        status,
        surface,
        notes,
      });
    } catch {
      // Ignore telemetry failures in UI.
    }
  };

  const executeAction = async (action: CopilotActionSuggestion) => {
    if (action.type === 'set_global_symbol') {
      const nextSymbol = typeof action.payload.symbol === 'string' ? action.payload.symbol : null;
      if (!nextSymbol) {
        await recordOutcome(action, 'failed', 'Missing symbol payload');
        return;
      }
      setGlobalSymbol(nextSymbol);
      setExecutedActionIds((prev) => ({ ...prev, [action.id]: `Switched to ${nextSymbol}` }));
      setPendingActionId(null);
      await recordOutcome(action, 'executed');
      return;
    }

    const widgetType = resolveWidgetType(action);
    if (!widgetType || !activeDashboard || !activeTab || !canEditCurrentDashboard) {
      await recordOutcome(action, 'failed', 'Dashboard not editable or widget type unavailable');
      return;
    }

    const widgetDefinition = getWidgetDefinition(widgetType);
    const widgetLabel = widgetDefinition?.name || widgetType;
    addWidget(activeDashboard.id, activeTab.id, {
      type: widgetType,
      tabId: activeTab.id,
      config: typeof action.payload.config === 'object' && action.payload.config
        ? action.payload.config as Record<string, unknown>
        : {},
      layout: {
        x: 0,
        y: Infinity,
        w: widgetDefinition?.defaultLayout.w || 6,
        h: widgetDefinition?.defaultLayout.h || 6,
        minW: widgetDefinition?.defaultLayout.minW || 3,
        minH: widgetDefinition?.defaultLayout.minH || 3,
      },
    });
    setExecutedActionIds((prev) => ({ ...prev, [action.id]: `Added ${widgetLabel}` }));
    setPendingActionId(null);
    await recordOutcome(action, 'executed');
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">
        <Sparkles size={12} className="text-cyan-400" />
        Suggested Actions
      </div>
      <div className="mt-3 space-y-2">
        {actions.map((action) => {
          const widgetType = resolveWidgetType(action);
          const disabled = action.type === 'add_widget' && (!activeDashboard || !activeTab || !canEditCurrentDashboard || !widgetType);
          const executedMessage = executedActionIds[action.id];
          const pending = pendingActionId === action.id;

          return (
            <div key={action.id} className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-[var(--text-primary)]">{action.label}</div>
                  {action.description && (
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">{action.description}</div>
                  )}
                  {action.sourceIds?.length ? (
                    <div className="mt-1 text-[10px] text-blue-300">{action.sourceIds.length} evidence refs</div>
                  ) : null}
                  {executedMessage && (
                    <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-300">
                      <Check size={10} />
                      {executedMessage}
                    </div>
                  )}
                  {disabled && !executedMessage && (
                    <div className="mt-2 text-[10px] text-amber-300">
                      Widget actions require an editable dashboard and active tab.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={disabled || Boolean(executedMessage)}
                  onClick={() => setPendingActionId(pending ? null : action.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {action.type === 'add_widget' ? <Plus size={11} /> : <RotateCcw size={11} />}
                  {pending ? 'Cancel' : 'Apply'}
                </button>
              </div>

              {pending && !executedMessage && (
                <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[11px] text-[var(--text-secondary)]">
                  <div>{action.confirmText || 'Apply this suggested action?'}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void executeAction(action)
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-cyan-500"
                    >
                      <Check size={10} />
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingActionId(null)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <X size={10} />
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[10px] text-[var(--text-muted)]">Current linked symbol: {globalSymbol}</div>
    </div>
  );
}

export default CopilotActionPanel
