'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Check, ExternalLink, Loader2, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
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
import { GLOBAL_SYSTEM_TEMPLATE_IDS } from '@/contexts/DashboardContext/constants';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import {
  findMatchingWidgetTarget,
  focusDashboardWidget,
  getIntentFromArtifact,
} from '@/lib/vniagentWorkspace';
import {
  buildArtifactProvenance,
  readArtifactPlacement,
  readArtifactWidgetProvenanceIndex,
  recordArtifactProvenance,
  rememberArtifactPlacement,
  type ArtifactWidgetProvenance,
} from '@/lib/copilotArtifactProvenance';
import {
  addNotebookItem,
  artifactNotebookDedupeKey,
} from '@/lib/researchNotebook'
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

/** Markdown table of a table artifact, for the research notebook body. */
function artifactNotebookBody(artifact: CopilotTableArtifact): string {
  const header = `| ${artifact.columns.map((column) => column.label).join(' | ')} |`
  const divider = `| ${artifact.columns.map(() => '---').join(' | ')} |`
  const rows = artifact.rows.map(
    (row) => `| ${artifact.columns.map((column) => formatArtifactValue(row[column.key], column.kind)).join(' | ')} |`,
  )
  return [header, divider, ...rows].join('\n')
}

function renderChartArtifact(artifact: CopilotChartArtifact) {
  return (
    <div className="mt-3 h-[220px] min-h-[220px] w-full overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)]/60 p-2">
      <ChartMountGuard className="h-full" minHeight={180} minWidth={180}>
        <ResponsiveContainer width="100%" height="100%" minWidth={180} minHeight={180}>
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
      </ChartMountGuard>
    </div>
  );
}

/** Where the user was told a promoted widget landed. */
interface PromotedWidget {
  widgetId: string
  artifactId: string
  responseId: string
  dashboardId: string
  tabId: string
  label: string
}

/**
 * Promotions performed in this panel instance, recorded BEFORE the (possibly
 * asynchronous) workspace update runs, so the first promotion is visible to
 * every card of the response immediately.
 *
 * Durable source of truth: `vnibb-copilot-artifact-provenance` in localStorage
 * plus the marker on the widget's own `config`
 * (see `recordArtifactProvenance` / `buildArtifactProvenance`).
 */
function usePromotedWidgets(responseId?: string) {
  const [promotedWidgets, setPromotedWidgets] = useState<PromotedWidget[]>([])
  const [restored, setRestored] = useState<{ widgetId: string; provenance: ArtifactWidgetProvenance }[]>([])

  useEffect(() => {
    if (!responseId) return
    const index = readArtifactWidgetProvenanceIndex()
    setRestored(
      Object.entries(index)
        .filter(([, provenance]) => provenance.responseId === responseId)
        .map(([widgetId, provenance]) => ({ widgetId, provenance })),
    )
  }, [responseId])

  const recordPromotion = (promotion: PromotedWidget) => {
    setPromotedWidgets((current) => [...current, promotion])
  }

  return { promotedWidgets, restored, recordPromotion }
}

interface ArtifactPlacementStore {
  /** Destination that was used most recently (persisted across reloads). */
  lastPlacement: { dashboardId: string; tabId: string } | null
  /** Destination chosen by the user for a specific artifact of this response. */
  choiceByArtifact: Record<string, { dashboardId: string; tabId: string }>
  chooseDestination: (artifactId: string, destination: { dashboardId: string; tabId: string; label: string }) => void
}

function useArtifactDestination(): ArtifactPlacementStore {
  const [lastPlacement, setLastPlacement] = useState<{ dashboardId: string; tabId: string } | null>(null)
  const [choiceByArtifact, setChoiceByArtifact] = useState<Record<string, { dashboardId: string; tabId: string }>>({})

  useEffect(() => {
    const stored = readArtifactPlacement()
    setLastPlacement(stored ? { dashboardId: stored.dashboardId, tabId: stored.tabId } : null)
  }, [])

  return {
    lastPlacement,
    choiceByArtifact,
    chooseDestination: (artifactId, destination) => {
      rememberArtifactPlacement(destination.dashboardId, destination.tabId, destination.label)
      setLastPlacement({ dashboardId: destination.dashboardId, tabId: destination.tabId })
      setChoiceByArtifact((current) => ({
        ...current,
        [artifactId]: { dashboardId: destination.dashboardId, tabId: destination.tabId },
      }))
    },
  }
}

export function CopilotArtifactPanel({ artifacts, responseMeta, surface = 'sidebar' }: CopilotArtifactPanelProps) {
  const { state, addWidget, setActiveDashboard, setActiveTab } = useDashboard();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const artifactKey = useMemo(() => artifacts.map((artifact) => artifact.id).join('|'), [artifacts]);
  const responseId = responseMeta?.responseId;
  const { promotedWidgets, restored, recordPromotion } = usePromotedWidgets(responseId);
  const { lastPlacement, choiceByArtifact, chooseDestination } = useArtifactDestination();
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
          addWidget={addWidget}
          setActiveDashboard={setActiveDashboard}
          setActiveTab={setActiveTab}
          globalSymbol={globalSymbol}
          setGlobalSymbol={setGlobalSymbol}
          promotedWidgets={promotedWidgets}
          restoredPromotions={restored}
          onWidgetPromoted={recordPromotion}
          lastPlacement={lastPlacement}
          destinationChoice={choiceByArtifact[artifact.id] ?? null}
          onDestinationChange={chooseDestination}
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
  addWidget: ReturnType<typeof useDashboard>['addWidget'];
  setActiveDashboard: ReturnType<typeof useDashboard>['setActiveDashboard'];
  setActiveTab: ReturnType<typeof useDashboard>['setActiveTab'];
  globalSymbol: string;
  setGlobalSymbol: ReturnType<typeof useSymbolLink>['setGlobalSymbol'];
  promotedWidgets: PromotedWidget[];
  restoredPromotions: { widgetId: string; provenance: ArtifactWidgetProvenance }[];
  onWidgetPromoted: (promotion: PromotedWidget) => void;
  lastPlacement: { dashboardId: string; tabId: string } | null;
  destinationChoice: { dashboardId: string; tabId: string } | null;
  onDestinationChange: (artifactId: string, destination: { dashboardId: string; tabId: string; label: string }) => void;
}
function ArtifactCard({
  artifact,
  responseMeta,
  surface,
  state,
  addWidget,
  setActiveDashboard,
  setActiveTab,
  globalSymbol,
  setGlobalSymbol,
  promotedWidgets,
  restoredPromotions,
  onWidgetPromoted,
  lastPlacement,
  destinationChoice,
  onDestinationChange,
}: ArtifactCardProps) {
  const intent = useMemo(() => getIntentFromArtifact(artifact), [artifact]);
  const existingTarget = useMemo(
    () => (intent ? findMatchingWidgetTarget(state, intent) : null),
    [intent, state],
  );
  const destinations = state.dashboards.flatMap((dashboard) =>
    dashboard.isEditable === false || GLOBAL_SYSTEM_TEMPLATE_IDS.has(dashboard.id) ? [] : dashboard.tabs.map((tab) => ({
      dashboardId: dashboard.id,
      tabId: tab.id,
      label: `${dashboard.name} / ${tab.name}`,
    })),
  );
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);

  // Remembered placements are matched against the current destination list, so a
  // dashboard/tab that no longer exists falls back instead of placing elsewhere.
  const chosenPlacement = selectedTabId
    ? destinations.find((item) => item.tabId === selectedTabId)
    : destinationChoice
      ? destinations.find((item) => item.tabId === destinationChoice.tabId && item.dashboardId === destinationChoice.dashboardId)
      : lastPlacement
        ? destinations.find((item) => item.tabId === lastPlacement.tabId && item.dashboardId === lastPlacement.dashboardId)
        : undefined;
  const destination = chosenPlacement
    ?? destinations.find((item) => item.dashboardId === state.activeDashboardId && item.tabId === state.activeTabId)
    ?? destinations[0];
  const [placementStatus, setPlacementStatus] = useState<string | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<{ dashboardId: string; symbol: string } | null>(null);

  useEffect(() => {
    if (!pendingSymbol || state.activeDashboardId !== pendingSymbol.dashboardId) return;
    if (globalSymbol === pendingSymbol.symbol) {
      setPendingSymbol(null);
      return;
    }
    setGlobalSymbol(pendingSymbol.symbol);
  }, [globalSymbol, pendingSymbol, setGlobalSymbol, state.activeDashboardId]);
  const [ratingStatus, setRatingStatus] = useState<'liked' | 'disliked' | undefined>(undefined)
  const [pendingRating, setPendingRating] = useState<'liked' | 'disliked' | null>(null)
  const [savedArtifacts, setSavedArtifacts] = useState<Record<string, true>>({})

  // Promotions of this response, newest first: live ones for this session, plus
  // what the durable provenance index says about widgets from earlier sessions.
  const responsePromotions = useMemo<PromotedWidget[]>(
    () => [
      ...[...promotedWidgets].reverse(),
      ...restoredPromotions.map((promotion) => ({
        widgetId: promotion.widgetId,
        artifactId: promotion.provenance.artifactId,
        responseId: promotion.provenance.responseId,
        dashboardId: promotion.provenance.dashboardId,
        tabId: promotion.provenance.tabId,
        label: promotion.provenance.destination,
      })),
    ],
    [promotedWidgets, restoredPromotions],
  )
  const promotedWidget = responsePromotions.find((promotion) => promotion.artifactId === artifact.id)
  const promotedPlacement = promotedWidget
    ? destinations.find((item) => item.dashboardId === promotedWidget.dashboardId && item.tabId === promotedWidget.tabId)
    : undefined
  const addedToLabel = promotedWidget
    ? promotedPlacement?.label || promotedWidget.label || 'personal workspace'
    : null
  const notebookDedupeKey = artifactNotebookDedupeKey({
    artifactId: artifact.id,
    responseId: responseMeta?.responseId,
    artifactTitle: artifact.title,
  })

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

  const rateArtifact = async (status: 'liked' | 'disliked') => {
    if (!responseMeta?.responseId) return
    try {
      setPendingRating(status)
      await submitCopilotOutcome({
        responseId: responseMeta.responseId,
        kind: 'artifact',
        itemId: artifact.id,
        status,
        surface,
      })
      setRatingStatus(status)
    } catch {
      // ignore telemetry failures in UI
    } finally {
      setPendingRating(null)
    }
  }

  const handleJumpToWidget = async () => {
    if (!existingTarget) return;
    if (intent?.symbol) {
      setPendingSymbol({ dashboardId: existingTarget.dashboardId, symbol: intent.symbol });
    }
    focusDashboardWidget(existingTarget, setActiveDashboard, setActiveTab)
    await recordOutcome('executed', 'Jumped to widget from artifact')
  }

  const handleCreateWidget = async () => {
    if (!intent || !destination) {
      await recordOutcome('failed', 'No editable destination tab')
      return
    }
    const responseId = responseMeta?.responseId ?? 'unlinked-response'
    const provenance: ArtifactWidgetProvenance = {
      artifactId: artifact.id,
      responseId,
      artifactType: artifact.type,
      artifactTitle: artifact.title,
      dashboardId: destination.dashboardId,
      tabId: destination.tabId,
      destination: destination.label,
      createdAt: new Date().toISOString(),
    }
    const definition = getWidgetDefinition(intent.widgetType)
    const widgetCreate: WidgetCreate = {
      type: intent.widgetType,
      tabId: destination.tabId,
      config: {
        ...intent.config,
        ...(intent.symbol ? { symbol: intent.symbol } : {}),
        ...buildArtifactProvenance(provenance),
      },
      layout: {
        x: 0,
        y: Infinity,
        w: definition?.defaultLayout.w || 6,
        h: definition?.defaultLayout.h || 6,
        minW: definition?.defaultLayout.minW || 3,
        minH: definition?.defaultLayout.minH || 3,
        maxW: definition?.defaultLayout.maxW,
        maxH: definition?.defaultLayout.maxH,
      },
    }
    try {
      const widget = addWidget(destination.dashboardId, destination.tabId, widgetCreate)
      // Recorded before the (possibly async) workspace update so every card of
      // this response shows the same added-to state right away.
      onWidgetPromoted({
        widgetId: widget.id,
        artifactId: artifact.id,
        responseId,
        dashboardId: destination.dashboardId,
        tabId: destination.tabId,
        label: destination.label,
      })
      try {
        // Durable, widget-keyed record so the state survives a reload.
        recordArtifactProvenance(widget.id, provenance)
      } catch {
        // The widget's own config marker already carries the provenance.
      }
      if (intent.symbol) setPendingSymbol({ dashboardId: destination.dashboardId, symbol: intent.symbol });
      focusDashboardWidget({ ...destination, widgetId: widget.id }, setActiveDashboard, setActiveTab)
      setPlacementStatus(`Added ${intent.label} to ${destination.label}.`)
      await recordOutcome('executed', `Created ${intent.label} in ${destination.label}`)
    } catch {
      setPlacementStatus(`Could not add ${intent.label}. Your workspace was not replaced.`)
      await recordOutcome('failed', 'Widget placement failed')
    }
  }

  const handleSaveToNotebook = () => {
    if (artifact.type !== 'table') return
    const symbol = intent?.symbol
      ?? artifact.rows.map((row) => row.symbol).find((value): value is string => typeof value === 'string' && Boolean(value))
    addNotebookItem({
      kind: 'artifact',
      title: artifact.title || artifact.id,
      body: artifactNotebookBody(artifact),
      symbol,
      tags: ['copilot artifact'],
      artifact: {
        artifactId: artifact.id,
        responseId: responseMeta?.responseId,
        artifactType: artifact.type,
      },
      dedupeKey: notebookDedupeKey,
      provenance: {
        sourceLabel: 'VniAgent artifact',
        apiGroup: '/copilot',
        endpoint: '/api/v1/copilot/chat/stream',
        symbol: intent?.symbol,
        localOnly: true,
        capturedAt: new Date().toISOString(),
      },
    })
    // The notebook write is synchronous, so the state already reflects the
    // dedupe: a second save of the same artifact adds nothing.
    setSavedArtifacts((current) => ({ ...current, [notebookDedupeKey]: true }))
  }

  return (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-40">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">{artifact.title}</div>
              {artifact.description && (
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{artifact.description}</div>
              )}
            </div>
            <div className="flex min-w-0 max-w-full flex-col items-end gap-2">
              <div className="text-[10px] text-blue-300">
                {artifact.type === 'chart' ? artifact.chartType : artifact.type}
                {artifact.sourceIds?.length ? ` · ${artifact.sourceIds.length} source refs` : ''}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { void rateArtifact('liked') }}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
                >
                  {pendingRating === 'liked' ? <Loader2 size={11} className="animate-spin" /> : ratingStatus === 'liked' ? <Check size={11} /> : <ThumbsUp size={11} />}
                  Useful
                </button>
                <button
                  type="button"
                  onClick={() => { void rateArtifact('disliked') }}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/20"
                >
                  {pendingRating === 'disliked' ? <Loader2 size={11} className="animate-spin" /> : ratingStatus === 'disliked' ? <Check size={11} /> : <ThumbsDown size={11} />}
                  Not useful
                </button>
              </div>
              {artifact.type === 'table' && (
                <button
                  type="button"
                  onClick={handleSaveToNotebook}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/20"
                >
                  {savedArtifacts[notebookDedupeKey] ? <Check size={11} /> : <BookMarked size={11} />}
                  {savedArtifacts[notebookDedupeKey] ? 'Saved to research notebook' : 'Save table to research notebook'}
                </button>
              )}
              {intent && (
                <div className="flex flex-wrap justify-end gap-2">
                  {existingTarget && (
                    <button
                      type="button"
                      onClick={() => { void handleJumpToWidget() }}
                      title={intent.symbol ? `Open ${intent.symbol}; updates the destination workspace ticker for linked widgets` : `Open ${intent.label}`}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
                    >
                      <ExternalLink size={11} />
                      Open {intent.symbol ? `${intent.symbol} ` : ''}{intent.label}
                    </button>
                  )}
                  {destination && (
                    <div className="flex min-w-0 w-full flex-col items-end gap-2">
                      <label className="flex w-full min-w-0 flex-col gap-1 text-[10px] text-[var(--text-muted)]">
                        Add to personal workspace
                        <select
                          aria-label={`Destination for ${intent.label}`}
                          value={destination.tabId}
                          onChange={(event) => {
                            setSelectedTabId(event.target.value)
                            setPlacementStatus(null)
                            const picked = destinations.find((item) => item.tabId === event.target.value)
                            if (picked) onDestinationChange(artifact.id, picked)
                          }}
                          className="w-full min-w-0 max-w-full rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] focus-visible:outline-blue-400"
                        >
                          {destinations.map((item) => <option key={item.tabId} value={item.tabId}>{item.label}</option>)}
                        </select>
                      </label>
                      <p className="max-w-64 text-right text-[10px] text-[var(--text-muted)]">
                        {intent.symbol ? `Uses ${intent.symbol} as the destination workspace ticker and updates its linked widgets. ` : ''}
                        Adds a live widget without replacing the destination layout.
                      </p>
                      <button
                        type="button"
                        onClick={() => { void handleCreateWidget() }}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:bg-blue-500/20"
                      >
                        <Plus size={11} />
                        Add {intent.symbol ? `${intent.symbol} ` : ''}{intent.label}
                      </button>
                    </div>
                  )}
                  {!destination && <p className="text-[10px] text-[var(--text-muted)]">Open an editable personal workspace to add this widget.</p>}
                </div>
              )}
            </div>
          </div>
          {addedToLabel && (
            <p
              role="status"
              data-provenance-widget={promotedWidget?.widgetId}
              className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-300"
            >
              <Check size={11} />
              Added to {addedToLabel}
            </p>
          )}
          {placementStatus && <p role="status" className="mt-2 text-[11px] text-[var(--text-secondary)]">{placementStatus}</p>}

          {artifact.type === 'table' ? renderTableArtifact(artifact) : renderChartArtifact(artifact)}
        </div>
  )
}

export default CopilotArtifactPanel
