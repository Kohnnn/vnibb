import type { CopilotArtifact, CopilotSourceRef, CopilotWidgetTarget } from '@/lib/api'
import type { Dashboard, DashboardState, WidgetCategory, WidgetInstance, WidgetType } from '@/types/dashboard'
import { getWidgetCapabilities, getWidgetCapabilityForEvidenceKind, normalizeWidgetType, validateWidgetCapabilityConfiguration } from '@/data/widgetDefinitions'
import type { VniAgentEvidenceKind, WidgetCapability } from '@/data/widgetDefinitions'

export interface VniAgentWorkspaceContextInput {
  widgetTypeKey?: string | null
  widgetType?: string
  symbol: string
  activeTab?: string | null
  dataSnapshot?: Record<string, unknown>
  widgetPayload?: Record<string, unknown> | null
}

/**
 * Capability context delivered inside the existing widgetPayload channel.
 * Identity fields are absent when no valid catalogue widget was selected.
 * Supported inputs use compact scalar descriptors so the runtime's bounded
 * browser-context sanitizer preserves allowed values and defaults at depth four.
 */
export interface VniAgentWidgetCapabilityContext {
  widgetType?: WidgetType
  name: string
  description: string
  category?: WidgetCategory
  coverage: 'mapped' | 'unknown'
  scope: 'symbol' | 'market' | 'unknown'
  symbolRequirement: string
  configurationInputs: readonly string[]
  evidenceKinds: readonly VniAgentEvidenceKind[]
  evidenceLimits: readonly string[]
  configuration: Partial<Record<string, string>>
  invalidConfigurationKeys: string[]
  resolvedSymbol: string | null
}

export interface VniAgentWorkspaceContext {
  widgetType: string
  widgetTypeKey: string | null
  activeTab: string | null
  symbol: string
  dataSnapshot: Record<string, unknown>
  widgetPayload: Record<string, unknown> & { symbol: string; widgetCapabilities: VniAgentWidgetCapabilityContext }
}

/** Copies only the catalogue capability fields, dropping any browser-supplied overrides. */
function toCapabilityContext(
  capability: WidgetCapability,
  configuration: { values: Partial<Record<string, string>>; invalidKeys: string[] },
  symbol: string,
): VniAgentWidgetCapabilityContext {
  return {
    widgetType: capability.widgetType,
    name: capability.name,
    description: capability.description,
    category: capability.category,
    coverage: capability.coverage,
    scope: capability.scope,
    symbolRequirement: capability.symbolRequirement,
    configurationInputs: capability.configurationInputs.map(input =>
      `${input.key} (${input.label}): allowed values ${input.values.join(', ')}; default ${input.defaultValue}. ${input.description}`
    ),
    evidenceKinds: capability.evidenceKinds,
    evidenceLimits: capability.evidenceLimits,
    configuration: configuration.values,
    invalidConfigurationKeys: configuration.invalidKeys,
    resolvedSymbol: capability.scope === 'symbol' ? symbol || null : null,
  }
}

function unscopedCapabilityContext(): VniAgentWidgetCapabilityContext {
  return {
    name: 'Dashboard',
    description: 'No valid catalogue widget is attached to this request.',
    coverage: 'unknown',
    scope: 'unknown',
    symbolRequirement: 'Unknown; no catalogue widget was selected.',
    configurationInputs: [],
    evidenceKinds: [],
    evidenceLimits: ['No valid catalogue widget was selected; no widget-specific VniAgent coverage is declared.'],
    configuration: {},
    invalidConfigurationKeys: [],
    resolvedSymbol: null,
  }
}

function readCapabilitySymbol(value: unknown): string {
  if (typeof value !== 'string') return ''
  const symbol = value.trim().toUpperCase()
  return /^[A-Z0-9]{3}$/.test(symbol) ? symbol : ''
}

export function buildVniAgentWorkspaceContext(input: VniAgentWorkspaceContextInput): VniAgentWorkspaceContext {
  const capability = getWidgetCapabilities(input.widgetTypeKey)
  const payload = input.widgetPayload || {}
  const widgetConfig = payload.widgetConfig && typeof payload.widgetConfig === 'object' && !Array.isArray(payload.widgetConfig)
    ? payload.widgetConfig as Record<string, unknown>
    : undefined
  const configuration = capability ? validateWidgetCapabilityConfiguration(capability, widgetConfig) : { values: {}, invalidKeys: [] }
  const symbol = capability?.scope === 'market'
    ? ''
    : readCapabilitySymbol(payload.symbol !== undefined ? payload.symbol : input.symbol)
  const snapshotMatchesScope = capability?.scope === 'symbol' && symbol === readCapabilitySymbol(input.symbol)

  return {
    widgetType: capability?.name || input.widgetType || 'Dashboard',
    widgetTypeKey: capability?.widgetType || null,
    activeTab: input.activeTab || null,
    symbol,
    dataSnapshot: snapshotMatchesScope ? input.dataSnapshot || {} : {},
    widgetPayload: {
      ...payload,
      symbol,
      widgetCapabilities: capability
        ? toCapabilityContext(capability, configuration, symbol)
        : unscopedCapabilityContext(),
    },
  }
}

export interface VniAgentWidgetIntent {
  widgetType: WidgetType
  label: string
  symbol?: string
  config?: Record<string, unknown>
}

function intentFromWidgetTarget(target?: CopilotWidgetTarget): VniAgentWidgetIntent | null {
  if (!target?.widgetType) {
    return null
  }
  const normalizedType = normalizeWidgetType(target.widgetType)
  return {
    widgetType: (normalizedType || target.widgetType) as WidgetType,
    label: target.label || target.widgetType,
    symbol: target.symbol,
    config: target.config,
  }
}

export interface VniAgentWidgetTarget {
  dashboardId: string
  tabId: string
  widgetId: string
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : []
}

function extractArtifactSymbols(artifact: CopilotArtifact): string[] {
  const rows = Array.isArray(artifact.rows) ? artifact.rows : []
  const symbols = rows
    .map((row) => row.symbol)
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
  return Array.from(new Set(symbols))
}

export function getIntentFromSource(source: CopilotSourceRef): VniAgentWidgetIntent | null {
  const directIntent = intentFromWidgetTarget(source.widgetTarget)
  if (directIntent) {
    return directIntent
  }

  const capability = getWidgetCapabilityForEvidenceKind(source.kind || '')
  if (!capability) return null
  return {
    widgetType: capability.widgetType,
    label: capability.name,
    symbol: capability.scope === 'symbol' ? source.symbol : undefined,
  }
}

export function getIntentFromArtifact(artifact: CopilotArtifact): VniAgentWidgetIntent | null {
  const directIntent = intentFromWidgetTarget(artifact.widgetTarget)
  if (directIntent) {
    return directIntent
  }

  switch (artifact.id) {
    case 'comparison_snapshot':
    case 'comparison_quality_chart':
      return {
        widgetType: 'comparison_analysis',
        label: 'Comparison Analysis',
        config: {
          initialSymbols: extractArtifactSymbols(artifact),
        },
      }
    case 'price_trend_chart':
      return {
        widgetType: 'price_chart',
        label: 'Price Chart',
        symbol: extractArtifactSymbols(artifact)[0],
      }
    case 'sector_breadth_snapshot':
    case 'sector_change_chart':
      return {
        widgetType: 'market_breadth',
        label: 'Market Breadth',
      }
    case 'foreign_flow_leaderboard':
    case 'foreign_flow_chart':
      return {
        widgetType: 'foreign_trading',
        label: 'Foreign Trading',
        symbol: extractArtifactSymbols(artifact)[0],
      }
    default:
      return null
  }
}

export function findMatchingWidgetTarget(
  state: DashboardState,
  intent: VniAgentWidgetIntent,
  resolveSymbol?: (dashboard: Dashboard, widget: WidgetInstance) => string,
): VniAgentWidgetTarget | null {
  const dashboards = state.dashboards || []
  const intentSymbols = asStringArray(intent.config?.initialSymbols)

  const candidates = dashboards.flatMap((dashboard) =>
    dashboard.tabs.flatMap((tab) =>
      tab.widgets.map((widget) => {
        if (widget.type !== intent.widgetType) {
          return null
        }
        if (intent.symbol && resolveSymbol && resolveSymbol(dashboard, widget).toUpperCase() !== intent.symbol.toUpperCase()) {
          return null
        }

        let score = 0
        if (dashboard.id === state.activeDashboardId) score += 2
        if (tab.id === state.activeTabId) score += 2

        const widgetSymbol = typeof widget.config?.symbol === 'string' ? widget.config.symbol : undefined
        if (!resolveSymbol && intent.symbol && widgetSymbol === intent.symbol) score += 2
        if (!widgetSymbol) score += 1

        const widgetInitialSymbols = asStringArray(widget.config?.initialSymbols)
        if (intentSymbols.length && widgetInitialSymbols.some((symbol) => intentSymbols.includes(symbol))) {
          score += 2
        }

        return {
          dashboardId: dashboard.id,
          tabId: tab.id,
          widgetId: widget.id,
          score,
        }
      })
    )
  ).filter((item): item is VniAgentWidgetTarget & { score: number } => Boolean(item))

  if (!candidates.length) {
    return null
  }

  candidates.sort((left, right) => right.score - left.score)
  const best = candidates[0]
  return {
    dashboardId: best.dashboardId,
    tabId: best.tabId,
    widgetId: best.widgetId,
  }
}

export function focusDashboardWidget(
  target: VniAgentWidgetTarget,
  setActiveDashboard: (id: string) => void,
  setActiveTab: (id: string) => void,
): void {
  setActiveDashboard(target.dashboardId)
  setActiveTab(target.tabId)

  window.setTimeout(() => {
    const element = document.querySelector<HTMLElement>(`[data-widget-id="${target.widgetId}"]`)
    if (!element) {
      return
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => element.focus(), 120)
  }, 180)
}
