import type { CopilotArtifact, CopilotSourceRef, CopilotWidgetTarget } from '@/lib/api'
import type { DashboardState, WidgetType } from '@/types/dashboard'

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
  return {
    widgetType: target.widgetType as WidgetType,
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

  switch (source.kind) {
    case 'company_profile':
      return { widgetType: 'company_profile', label: 'Company Profile', symbol: source.symbol }
    case 'price_history':
      return { widgetType: 'price_chart', label: 'Price Chart', symbol: source.symbol }
    case 'financial_ratios':
      return { widgetType: 'financial_ratios', label: 'Financial Ratios', symbol: source.symbol }
    case 'income_statement':
      return { widgetType: 'income_statement', label: 'Income Statement', symbol: source.symbol }
    case 'balance_sheet':
      return { widgetType: 'balance_sheet', label: 'Balance Sheet', symbol: source.symbol }
    case 'cash_flow':
      return { widgetType: 'cash_flow', label: 'Cash Flow', symbol: source.symbol }
    case 'company_news':
      return { widgetType: 'news_feed', label: 'News Feed', symbol: source.symbol }
    case 'foreign_trading':
      return { widgetType: 'foreign_trading', label: 'Foreign Trading', symbol: source.symbol }
    case 'order_flow':
      return { widgetType: 'transaction_flow', label: 'Transaction Flow', symbol: source.symbol }
    case 'insider_deals':
      return { widgetType: 'insider_trading', label: 'Insider Trading', symbol: source.symbol }
    case 'company_events':
      return { widgetType: 'events_calendar', label: 'Events Calendar', symbol: source.symbol }
    case 'dividends':
      return { widgetType: 'dividend_payment', label: 'Dividend Payment', symbol: source.symbol }
    case 'market_indices':
      return { widgetType: 'market_overview', label: 'Market Overview' }
    case 'sector_breadth':
      return { widgetType: 'market_breadth', label: 'Market Breadth' }
    default:
      return null
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
): VniAgentWidgetTarget | null {
  const dashboards = state.dashboards || []
  const intentSymbols = asStringArray(intent.config?.initialSymbols)

  const candidates = dashboards.flatMap((dashboard) =>
    dashboard.tabs.flatMap((tab) =>
      tab.widgets.map((widget) => {
        if (widget.type !== intent.widgetType) {
          return null
        }

        let score = 0
        if (dashboard.id === state.activeDashboardId) score += 2
        if (tab.id === state.activeTabId) score += 2

        const widgetSymbol = typeof widget.config?.symbol === 'string' ? widget.config.symbol : undefined
        if (intent.symbol && widgetSymbol === intent.symbol) score += 2
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
