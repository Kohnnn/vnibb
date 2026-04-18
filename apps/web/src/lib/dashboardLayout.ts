import type { WidgetType } from '@/types/dashboard'

export interface CompactableLayoutItem {
  type?: WidgetType | string
  layout: {
    x: number
    y: number
    w: number
    h: number
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
  }
}

type LayoutOrientation = 'horizontal' | 'vertical' | 'balanced'

interface LayoutBehavior {
  preferredW: number
  preferredH: number
  minW: number
  minH: number
  maxW?: number
  maxH?: number
  orientation: LayoutOrientation
  expandPriority: number
}

export interface WidgetSizeContract {
  defaultW: number
  defaultH: number
  minW: number
  minH: number
  maxW?: number
  maxH?: number
  bias: LayoutOrientation | 'full'
  priority: 1 | 2 | 3
}

export interface WidgetDefaultLayout {
  x: number
  y: number
  w: number
  h: number
  minW: number
  minH: number
  maxW?: number
  maxH?: number
}

interface ResolvedLayoutBehavior extends LayoutBehavior {
  maxW: number
  maxH?: number
  autoFitMaxW: number
}

const FALLBACK_BEHAVIOR: LayoutBehavior = {
  preferredW: 6,
  preferredH: 5,
  minW: 3,
  minH: 3,
  orientation: 'balanced',
  expandPriority: 2,
}

const WIDGET_LAYOUT_BEHAVIORS: Partial<Record<WidgetType, LayoutBehavior>> = {
  screener: { preferredW: 16, preferredH: 10, minW: 12, minH: 8, orientation: 'horizontal', expandPriority: 6 },
  ticker_info: { preferredW: 8, preferredH: 6, minW: 5, minH: 4, orientation: 'balanced', expandPriority: 2 },
  valuation_band: { preferredW: 14, preferredH: 8, minW: 10, minH: 6, orientation: 'horizontal', expandPriority: 4 },
  key_metrics: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 2 },
  share_statistics: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 1 },
  ticker_profile: { preferredW: 12, preferredH: 5, minW: 6, minH: 4, orientation: 'horizontal', expandPriority: 3 },
  price_chart: { preferredW: 16, preferredH: 10, minW: 10, minH: 8, orientation: 'horizontal', expandPriority: 5 },
  tradingview_chart: { preferredW: 15, preferredH: 10, minW: 10, minH: 8, orientation: 'horizontal', expandPriority: 5 },
  tradingview_ticker_tape: { preferredW: 24, preferredH: 4, minW: 12, minH: 3, orientation: 'horizontal', expandPriority: 6 },
  tradingview_technical_analysis: { preferredW: 9, preferredH: 10, minW: 8, minH: 8, orientation: 'vertical', expandPriority: 3 },
  earnings_season_monitor: { preferredW: 14, preferredH: 8, minW: 10, minH: 6, orientation: 'horizontal', expandPriority: 5 },
  earnings_release_recap: { preferredW: 12, preferredH: 9, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 4 },
  derivatives_contracts_board: { preferredW: 10, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  derivatives_price_history: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 3 },
  unified_financials: { preferredW: 24, preferredH: 18, minW: 16, minH: 12, orientation: 'horizontal', expandPriority: 6 },
  financial_snapshot: { preferredW: 24, preferredH: 16, minW: 12, minH: 10, orientation: 'horizontal', expandPriority: 6 },
  quick_stats: { preferredW: 6, preferredH: 6, minW: 4, minH: 4, orientation: 'vertical', expandPriority: 2 },
  financial_ratios: { preferredW: 12, preferredH: 10, minW: 8, minH: 8, orientation: 'horizontal', expandPriority: 4 },
  income_statement: { preferredW: 12, preferredH: 10, minW: 8, minH: 8, orientation: 'horizontal', expandPriority: 4 },
  income_sankey: { preferredW: 14, preferredH: 10, minW: 10, minH: 7, orientation: 'horizontal', expandPriority: 4 },
  balance_sheet: { preferredW: 12, preferredH: 10, minW: 8, minH: 8, orientation: 'horizontal', expandPriority: 4 },
  cash_flow: { preferredW: 12, preferredH: 10, minW: 8, minH: 8, orientation: 'horizontal', expandPriority: 4 },
  cashflow_waterfall: { preferredW: 14, preferredH: 10, minW: 10, minH: 7, orientation: 'horizontal', expandPriority: 4 },
  major_shareholders: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 1 },
  insider_trading: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 1 },
  officers_management: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  news_feed: { preferredW: 10, preferredH: 7, minW: 5, minH: 4, orientation: 'vertical', expandPriority: 1 },
  news_corporate_actions: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'vertical', expandPriority: 2 },
  events_calendar: { preferredW: 12, preferredH: 8, minW: 8, minH: 5, orientation: 'vertical', expandPriority: 2 },
  market_news: { preferredW: 14, preferredH: 8, minW: 10, minH: 6, orientation: 'vertical', expandPriority: 2 },
  volume_analysis: { preferredW: 8, preferredH: 6, minW: 6, minH: 5, orientation: 'horizontal', expandPriority: 2 },
  peer_comparison: { preferredW: 14, preferredH: 8, minW: 10, minH: 6, orientation: 'horizontal', expandPriority: 4 },
  comparison_analysis: { preferredW: 10, preferredH: 8, minW: 6, minH: 5, orientation: 'vertical', expandPriority: 2 },
  rs_ranking: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'vertical', expandPriority: 2 },
  transaction_flow: { preferredW: 12, preferredH: 10, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 4 },
  foreign_trading: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 1 },
  orderbook: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 2 },
  intraday_trades: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 3 },
  block_trade: { preferredW: 12, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 3 },
  market_overview: { preferredW: 8, preferredH: 9, minW: 5, minH: 5, orientation: 'balanced', expandPriority: 2 },
  listing_browser: { preferredW: 10, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  top_movers: { preferredW: 8, preferredH: 9, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 1 },
  market_breadth: { preferredW: 8, preferredH: 10, minW: 6, minH: 7, orientation: 'balanced', expandPriority: 2 },
  market_heatmap: { preferredW: 12, preferredH: 15, minW: 10, minH: 12, orientation: 'horizontal', expandPriority: 4 },
  sector_board: { preferredW: 12, preferredH: 15, minW: 10, minH: 12, orientation: 'vertical', expandPriority: 2 },
  money_flow_trend: { preferredW: 14, preferredH: 12, minW: 10, minH: 9, orientation: 'horizontal', expandPriority: 3 },
  industry_bubble: { preferredW: 10, preferredH: 12, minW: 8, minH: 9, orientation: 'balanced', expandPriority: 2 },
  seasonality_heatmap: { preferredW: 14, preferredH: 13, minW: 10, minH: 10, orientation: 'horizontal', expandPriority: 5 },
  sortino_monthly: { preferredW: 10, preferredH: 13, minW: 8, minH: 10, orientation: 'vertical', expandPriority: 2 },
  volume_profile: { preferredW: 12, preferredH: 11, minW: 8, minH: 8, orientation: 'vertical', expandPriority: 2 },
  volume_flow: { preferredW: 8, preferredH: 10, minW: 6, minH: 8, orientation: 'balanced', expandPriority: 2 },
  momentum: { preferredW: 8, preferredH: 11, minW: 6, minH: 8, orientation: 'balanced', expandPriority: 2 },
  drawdown_recovery: { preferredW: 8, preferredH: 11, minW: 6, minH: 8, orientation: 'balanced', expandPriority: 2 },
  gap_analysis: { preferredW: 8, preferredH: 10, minW: 6, minH: 8, orientation: 'balanced', expandPriority: 2 },
  correlation_matrix: { preferredW: 14, preferredH: 12, minW: 10, minH: 9, orientation: 'vertical', expandPriority: 2 },
  ichimoku: { preferredW: 12, preferredH: 14, minW: 10, minH: 10, orientation: 'horizontal', expandPriority: 3 },
  fibonacci: { preferredW: 12, preferredH: 12, minW: 10, minH: 9, orientation: 'horizontal', expandPriority: 3 },
  technical_summary: { preferredW: 8, preferredH: 10, minW: 6, minH: 8, orientation: 'balanced', expandPriority: 2 },
  technical_snapshot: { preferredW: 8, preferredH: 9, minW: 6, minH: 7, orientation: 'balanced', expandPriority: 2 },
  atr_regime: { preferredW: 8, preferredH: 12, minW: 6, minH: 8, orientation: 'balanced', expandPriority: 2 },
  macd_crossovers: { preferredW: 8, preferredH: 12, minW: 6, minH: 9, orientation: 'balanced', expandPriority: 2 },
  rsi_seasonal: { preferredW: 8, preferredH: 12, minW: 6, minH: 9, orientation: 'balanced', expandPriority: 2 },
  bollinger_squeeze: { preferredW: 8, preferredH: 12, minW: 6, minH: 9, orientation: 'balanced', expandPriority: 2 },
  ema_respect: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'balanced', expandPriority: 2 },
  obv_divergence: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'balanced', expandPriority: 2 },
  volume_delta: { preferredW: 8, preferredH: 8, minW: 6, minH: 7, orientation: 'vertical', expandPriority: 2 },
  gap_fill_stats: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'balanced', expandPriority: 2 },
  hurst_market_structure: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'balanced', expandPriority: 2 },
  parkinson_volatility: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'balanced', expandPriority: 2 },
  amihud_illiquidity: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'balanced', expandPriority: 2 },
  risk_dashboard: { preferredW: 12, preferredH: 10, minW: 8, minH: 8, orientation: 'horizontal', expandPriority: 4 },
  quant_summary: { preferredW: 24, preferredH: 8, minW: 10, minH: 6, orientation: 'horizontal', expandPriority: 4 },
  relative_rotation: { preferredW: 12, preferredH: 10, minW: 8, minH: 8, orientation: 'balanced', expandPriority: 2 },
  market_sentiment: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  ttm_snapshot: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  growth_bridge: { preferredW: 10, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 2 },
  ownership_rating_summary: { preferredW: 8, preferredH: 8, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  derivatives_analytics: { preferredW: 10, preferredH: 8, minW: 8, minH: 6, orientation: 'horizontal', expandPriority: 2 },
  world_indices: { preferredW: 10, preferredH: 8, minW: 8, minH: 6, orientation: 'vertical', expandPriority: 2 },
  forex_rates: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  commodities: { preferredW: 8, preferredH: 7, minW: 6, minH: 6, orientation: 'vertical', expandPriority: 2 },
  signal_summary: { preferredW: 24, preferredH: 8, minW: 12, minH: 6, orientation: 'horizontal', expandPriority: 6 },
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function toWidgetSizeContract(behavior: LayoutBehavior | undefined): WidgetSizeContract {
  const resolved = behavior ?? FALLBACK_BEHAVIOR
  return {
    defaultW: resolved.preferredW,
    defaultH: resolved.preferredH,
    minW: resolved.minW,
    minH: resolved.minH,
    maxW: resolved.maxW,
    maxH: resolved.maxH,
    bias: resolved.maxW && resolved.maxW >= 24 ? 'full' : resolved.orientation,
    priority: resolved.expandPriority >= 5 ? 1 : resolved.expandPriority >= 2 ? 2 : 3,
  }
}

export function getWidgetSizeContract(type?: WidgetType | string): WidgetSizeContract {
  if (!type) return toWidgetSizeContract(undefined)
  return toWidgetSizeContract(WIDGET_LAYOUT_BEHAVIORS[type as WidgetType])
}

export function getWidgetDefaultLayout(type?: WidgetType | string, cols = 24): WidgetDefaultLayout {
  const item = normalizeItemLayout(
    {
      type,
      layout: { x: 0, y: 0, w: 0, h: 0 },
    },
    cols
  )

  return item.layout as WidgetDefaultLayout
}

function layoutsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function findNextAvailableLayout<T extends CompactableLayoutItem>(
  items: T[],
  type?: WidgetType | string,
  cols = 24
): WidgetDefaultLayout {
  const defaults = getWidgetDefaultLayout(type, cols)
  const normalizedItems = items
    .map((item) => normalizeItemLayout(item, cols))
    .filter((item) => Number.isFinite(item.layout.x) && Number.isFinite(item.layout.y))

  const maxY = normalizedItems.reduce((acc, item) => Math.max(acc, item.layout.y + item.layout.h), 0)
  const searchLimit = maxY + defaults.h + 48

  for (let y = 0; y <= searchLimit; y += 1) {
    for (let x = 0; x <= cols - defaults.w; x += 1) {
      const candidate = { x, y, w: defaults.w, h: defaults.h }
      const hasOverlap = normalizedItems.some((item) => layoutsOverlap(candidate, item.layout))
      if (!hasOverlap) {
        return {
          ...defaults,
          x,
          y,
        }
      }
    }
  }

  return {
    ...defaults,
    x: 0,
    y: maxY,
  }
}

function inferOrientation(layout: CompactableLayoutItem['layout']): LayoutOrientation {
  const ratio = (layout.w || 1) / Math.max(layout.h || 1, 1)
  if (ratio >= 1.45) return 'horizontal'
  if (ratio <= 0.85) return 'vertical'
  return 'balanced'
}

function resolveLayoutBehavior(item: CompactableLayoutItem, cols: number): ResolvedLayoutBehavior {
  const explicit = item.type ? WIDGET_LAYOUT_BEHAVIORS[item.type as WidgetType] : undefined
  const inferredOrientation = explicit?.orientation ?? inferOrientation(item.layout)
  const minW = Math.max(item.layout.minW ?? explicit?.minW ?? FALLBACK_BEHAVIOR.minW, explicit?.minW ?? 1)
  const minH = Math.max(item.layout.minH ?? explicit?.minH ?? FALLBACK_BEHAVIOR.minH, explicit?.minH ?? 1)

  const preferredWBase = explicit?.preferredW ?? item.layout.w ?? FALLBACK_BEHAVIOR.preferredW
  const preferredHBase = explicit?.preferredH ?? item.layout.h ?? FALLBACK_BEHAVIOR.preferredH

  const maxW = Math.min(item.layout.maxW ?? cols, cols)
  const autoFitMaxW = Math.min(item.layout.maxW ?? explicit?.maxW ?? maxW, cols)
  const maxH = item.layout.maxH ?? explicit?.maxH

  return {
    preferredW: clamp(Math.max(item.layout.w ?? 0, preferredWBase), minW, maxW),
    preferredH: clamp(Math.max(item.layout.h ?? 0, preferredHBase), minH, maxH ?? Number.MAX_SAFE_INTEGER),
    minW,
    minH,
    maxW,
    maxH,
    autoFitMaxW,
    orientation: inferredOrientation,
    expandPriority: explicit?.expandPriority ?? (inferredOrientation === 'horizontal' ? 3 : inferredOrientation === 'balanced' ? 2 : 1),
  }
}

function normalizeItemLayout<T extends CompactableLayoutItem>(item: T, cols: number): T {
  const behavior = resolveLayoutBehavior(item, cols)

  return {
    ...item,
    layout: {
      ...item.layout,
      w: clamp(item.layout.w || behavior.preferredW, behavior.minW, behavior.maxW),
      h: clamp(item.layout.h || behavior.preferredH, behavior.minH, behavior.maxH ?? Number.MAX_SAFE_INTEGER),
      minW: behavior.minW,
      minH: behavior.minH,
      maxW: item.layout.maxW,
      maxH: item.layout.maxH ?? behavior.maxH,
    },
  }
}

function expandRowWidths<RowItem extends CompactableLayoutItem>(row: Array<RowItem & { __behavior: ResolvedLayoutBehavior }>, cols: number) {
  const orderedIndexes = row
    .map((item, index) => ({ index, priority: item.__behavior.expandPriority }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((entry) => entry.index)

  let remaining = cols - row.reduce((sum, item) => sum + item.layout.w, 0)

  while (remaining > 0) {
    let progressed = false

    for (const index of orderedIndexes) {
      if (remaining <= 0) break
      const item = row[index]
      const maxWidth = item.__behavior.autoFitMaxW
      if (item.layout.w >= maxWidth) continue

      item.layout.w += 1
      remaining -= 1
      progressed = true
    }

    if (!progressed) {
      break
    }
  }
}

export function preserveTemplateGridItems<T extends CompactableLayoutItem>(items: T[], cols = 24): T[] {
  return items.map((item) => normalizeItemLayout(item, cols))
}

export function autoFitGridItems<T extends CompactableLayoutItem>(items: T[], cols = 24): T[] {
  const normalized = items.map((item) => ({
    ...normalizeItemLayout(item, cols),
    __behavior: resolveLayoutBehavior(item, cols),
  }))

  const fitted: Array<T & { __behavior: ResolvedLayoutBehavior }> = []
  let row: Array<(T & { __behavior: ResolvedLayoutBehavior })> = []
  let rowWidth = 0
  let currentY = 0

  const flushRow = () => {
    if (row.length === 0) return

    expandRowWidths(row, cols)

    let currentX = 0
    let rowHeight = 0

    row.forEach((item) => {
      const nextItem = {
        ...item,
        layout: {
          ...item.layout,
          x: currentX,
          y: currentY,
        },
      }

      rowHeight = Math.max(rowHeight, nextItem.layout.h)
      currentX += nextItem.layout.w
      fitted.push(nextItem)
    })

    currentY += rowHeight
    row = []
    rowWidth = 0
  }

  normalized.forEach((item) => {
    const width = Math.min(item.layout.w, cols)

    if (row.length > 0 && rowWidth + width > cols) {
      flushRow()
    }

    row.push({
      ...item,
      layout: {
        ...item.layout,
        w: width,
      },
    })
    rowWidth += width
  })

  flushRow()

  return fitted.map((item) => {
    const { __behavior: _behavior, ...rest } = item
    return rest as unknown as T
  })
}

export function compactGridItems<T extends CompactableLayoutItem>(items: T[], cols = 24): T[] {
  const normalized = items
    .map((item) => normalizeItemLayout(item, cols))
    .sort((left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x)

  const compacted: T[] = []

  normalized.forEach((item) => {
    const placedItem = {
      ...item,
      layout: {
        ...item.layout,
        x: clamp(item.layout.x || 0, 0, Math.max(cols - item.layout.w, 0)),
        y: item.layout.y || 0,
      },
    }

    for (let nextY = 0; nextY <= placedItem.layout.y; nextY += 1) {
      const candidate = {
        ...placedItem.layout,
        y: nextY,
      }
      const hasOverlap = compacted.some((existing) => layoutsOverlap(candidate, existing.layout))
      if (!hasOverlap) {
        placedItem.layout.y = nextY
        break
      }
    }

    compacted.push(placedItem)
  })

  return compacted
}
