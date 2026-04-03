'use client';

import { useEffect, useMemo } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  submitCopilotOutcome,
  type CopilotArtifact,
  type CopilotArtifactValueKind,
  type CopilotChartArtifact,
  type CopilotResponseMeta,
  type CopilotTableArtifact,
} from '@/lib/api';
import { useDashboard } from '@/contexts/DashboardContext';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import {
  findMatchingWidgetTarget,
  focusDashboardWidget,
  getIntentFromArtifact,
} from '@/lib/vniagentWorkspace';
import type { WidgetCreate } from '@/types/dashboard';

interface CopilotArtifactPanelProps {
  artifacts: CopilotArtifact[];
  responseMeta?: CopilotResponseMeta;
  surface?: 'sidebar' | 'widget' | 'analysis';
}

function formatArtifactValue(
  value: string | number | null | undefined,
  kind?: CopilotArtifactValueKind,
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value !== 'number') {
    return String(value);
  }

  if (kind === 'percent') {
    return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
  }

  if (kind === 'currency' || kind === 'large_number') {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    });
  }

  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
}

function renderTableArtifact(artifact: CopilotTableArtifact) {
  return (
    <div className="mt-3 overflow-auto">
      <table className="data-table w-full min-w-[560px] text-[10px] border-collapse">
        <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
          <tr>
            {artifact.columns.map((column) => (
              <th
                key={column.key}
                className={`px-2 py-2 font-medium ${column.kind === 'text' || !column.kind ? 'text-left' : 'text-right'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {artifact.rows.map((row, rowIndex) => (
            <tr key={`${artifact.id}-${rowIndex}`} className="hover:bg-[var(--bg-hover)]/70">
              {artifact.columns.map((column) => (
                <td
                  key={`${artifact.id}-${rowIndex}-${column.key}`}
                  className={`px-2 py-1.5 ${column.kind === 'text' || !column.kind ? 'text-left text-[var(--text-secondary)]' : 'text-right font-mono text-[var(--text-primary)]'}`}
                >
                  {formatArtifactValue(row[column.key], column.kind)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChartArtifact(artifact: CopilotChartArtifact) {
  return (
    <div className="mt-3 h-[220px] min-h-[220px] w-full overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)]/60 p-2">
      <ResponsiveContainer width="100%" height="100%">
        {artifact.chartType === 'bar' ? (
          <BarChart data={artifact.rows} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey={artifact.xKey} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              tickFormatter={(value) => formatArtifactValue(Number(value), artifact.valueKind)}
            />
            <Tooltip
              formatter={(value, _name, item) => {
                const dataKey = item && ('dataKey' in item) ? item.dataKey : undefined;
                const series = artifact.series.find((entry) => entry.key === dataKey);
                return [formatArtifactValue(typeof value === 'number' ? value : value !== undefined ? Number(value) : undefined, artifact.valueKind), series?.label || String(dataKey || '')];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            {artifact.series.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={series.color || '#22d3ee'}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={artifact.rows} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey={artifact.xKey} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              tickFormatter={(value) => formatArtifactValue(Number(value), artifact.valueKind)}
            />
            <Tooltip
              formatter={(value, _name, item) => {
                const dataKey = item && ('dataKey' in item) ? item.dataKey : undefined;
                const series = artifact.series.find((entry) => entry.key === dataKey);
                return [formatArtifactValue(typeof value === 'number' ? value : value !== undefined ? Number(value) : undefined, artifact.valueKind), series?.label || String(dataKey || '')];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            {artifact.series.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color || '#22d3ee'}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function CopilotArtifactPanel({ artifacts, responseMeta, surface = 'sidebar' }: CopilotArtifactPanelProps) {
  const { state, activeDashboard, activeTab, addWidget, setActiveDashboard, setActiveTab } = useDashboard();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const artifactKey = useMemo(() => artifacts.map((artifact) => artifact.id).join('|'), [artifacts]);

  useEffect(() => {
    if (!responseMeta?.responseId || !artifacts.length) {
      return;
    }

    artifacts.forEach((artifact) => {
      void submitCopilotOutcome({
        responseId: responseMeta.responseId,
        kind: 'artifact',
        itemId: artifact.id,
        status: 'shown',
        surface,
      }).catch(() => undefined)
    })
  }, [artifactKey, artifacts, responseMeta?.responseId, surface])

  if (!artifacts.length) {
    return null;
  }

  return (
    <div className="space-y-3">
      {artifacts.map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          responseMeta={responseMeta}
          surface={surface}
          state={state}
          activeDashboardId={activeDashboard?.id || null}
          activeTabId={activeTab?.id || null}
          canEditCurrentDashboard={Boolean(activeDashboard && activeTab && ((activeDashboard.adminUnlocked === true) || activeDashboard.isEditable !== false))}
          addWidget={addWidget}
          setActiveDashboard={setActiveDashboard}
          setActiveTab={setActiveTab}
          globalSymbol={globalSymbol}
          setGlobalSymbol={setGlobalSymbol}
        />
      ))}
    </div>
  );
}

interface ArtifactCardProps {
  artifact: CopilotArtifact;
  responseMeta?: CopilotResponseMeta;
  surface: 'sidebar' | 'widget' | 'analysis';
  state: Parameters<typeof findMatchingWidgetTarget>[0];
  activeDashboardId: string | null;
  activeTabId: string | null;
  canEditCurrentDashboard: boolean;
  addWidget: ReturnType<typeof useDashboard>['addWidget'];
  setActiveDashboard: ReturnType<typeof useDashboard>['setActiveDashboard'];
  setActiveTab: ReturnType<typeof useDashboard>['setActiveTab'];
  globalSymbol: string;
  setGlobalSymbol: ReturnType<typeof useSymbolLink>['setGlobalSymbol'];
}

function ArtifactCard({
  artifact,
  responseMeta,
  surface,
  state,
  activeDashboardId,
  activeTabId,
  canEditCurrentDashboard,
  addWidget,
  setActiveDashboard,
  setActiveTab,
  globalSymbol,
  setGlobalSymbol,
}: ArtifactCardProps) {
  const intent = useMemo(() => getIntentFromArtifact(artifact), [artifact]);
  const existingTarget = useMemo(
    () => (intent ? findMatchingWidgetTarget(state, intent) : null),
    [intent, state],
  );

  const recordOutcome = async (status: 'executed' | 'failed', notes?: string) => {
    if (!responseMeta?.responseId) return;
    try {
      await submitCopilotOutcome({
        responseId: responseMeta.responseId,
        kind: 'artifact',
        itemId: artifact.id,
        status,
        surface,
        notes,
      })
    } catch {
      // Ignore telemetry failures in UI.
    }
  }

  const handleJumpToWidget = async () => {
    if (!existingTarget) return;
    if (intent?.symbol && globalSymbol !== intent.symbol) {
      setGlobalSymbol(intent.symbol)
    }
    focusDashboardWidget(existingTarget, setActiveDashboard, setActiveTab)
    await recordOutcome('executed', 'Jumped to widget from artifact')
  }

  const handleCreateWidget = async () => {
    if (!intent || !activeDashboardId || !activeTabId || !canEditCurrentDashboard) {
      await recordOutcome('failed', 'Dashboard not editable or no active tab')
      return
    }
    const definition = getWidgetDefinition(intent.widgetType)
    const widgetCreate: WidgetCreate = {
      type: intent.widgetType,
      tabId: activeTabId,
      config: intent.config || {},
      layout: {
        x: 0,
        y: Infinity,
        w: definition?.defaultLayout.w || 6,
        h: definition?.defaultLayout.h || 6,
        minW: definition?.defaultLayout.minW || 3,
        minH: definition?.defaultLayout.minH || 3,
      },
    }
    addWidget(activeDashboardId, activeTabId, widgetCreate)
    await recordOutcome('executed', 'Created widget from artifact')
  }

  return (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">{artifact.title}</div>
              {artifact.description && (
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{artifact.description}</div>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-[10px] text-blue-300">
                {artifact.type === 'chart' ? artifact.chartType : artifact.type}
                {artifact.sourceIds?.length ? ` · ${artifact.sourceIds.length} source refs` : ''}
              </div>
              {intent && (
                <div className="flex flex-wrap justify-end gap-2">
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
                  {canEditCurrentDashboard && (
                    <button
                      type="button"
                      onClick={() => { void handleCreateWidget() }}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:bg-blue-500/20"
                    >
                      <Plus size={11} />
                      Create widget
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {artifact.type === 'table' ? renderTableArtifact(artifact) : renderChartArtifact(artifact)}
        </div>
  )
}

export default CopilotArtifactPanel
