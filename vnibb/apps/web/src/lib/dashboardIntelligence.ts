import type { WidgetInstance, WidgetType } from '@/types/dashboard'
import { getWidgetSizeContract } from '@/lib/dashboardLayout'

export interface WidgetLayoutInsight {
  widgetId: string
  type: WidgetType
  title: string
  detail: string
  severity: 'info' | 'warning'
  kind: 'compacted_sparse' | 'undersized'
}

export interface TabIntelligence {
  duplicateTypes: Array<{ type: WidgetType; count: number }>
  compactedSparseWidgets: WidgetLayoutInsight[]
  undersizedWidgets: WidgetLayoutInsight[]
  recommendations: string[]
  isDeadTab: boolean
  isDenseTab: boolean
}

const REPEATABLE_WIDGET_TYPES = new Set<WidgetType>([
  'price_chart',
  'tradingview_chart',
  'notes',
  'watchlist',
])

function prettifyWidgetType(type: WidgetType): string {
  return type.replace(/_/g, ' ')
}

export function getWidgetLayoutInsight(widget: WidgetInstance): WidgetLayoutInsight | null {
  const contract = getWidgetSizeContract(widget.type)
  const layoutMinH = widget.layout.minH ?? contract.minH
  const title = prettifyWidgetType(widget.type)

  if (widget.layout.h < layoutMinH) {
    return {
      widgetId: widget.id,
      type: widget.type,
      title,
      detail: `${title} is auto-compacted below its normal minimum height, which usually means this widget is in a sparse or empty state.`,
      severity: 'warning',
      kind: 'compacted_sparse',
    }
  }

  if (widget.layout.h + 1 < contract.defaultH) {
    return {
      widgetId: widget.id,
      type: widget.type,
      title,
      detail: `${title} is shorter than its recommended height and may clip rows, labels, or chart detail.`,
      severity: 'info',
      kind: 'undersized',
    }
  }

  return null
}

export function analyzeDashboardTab(widgets: WidgetInstance[]): TabIntelligence {
  const duplicateMap = new Map<WidgetType, number>()
  const compactedSparseWidgets: WidgetLayoutInsight[] = []
  const undersizedWidgets: WidgetLayoutInsight[] = []

  for (const widget of widgets) {
    if (!REPEATABLE_WIDGET_TYPES.has(widget.type)) {
      duplicateMap.set(widget.type, (duplicateMap.get(widget.type) || 0) + 1)
    }

    const insight = getWidgetLayoutInsight(widget)
    if (!insight) continue
    if (insight.kind === 'compacted_sparse') {
      compactedSparseWidgets.push(insight)
    } else {
      undersizedWidgets.push(insight)
    }
  }

  const duplicateTypes = Array.from(duplicateMap.entries())
    .filter(([, count]) => count > 1)
    .map(([type, count]) => ({ type, count }))

  const isDeadTab = compactedSparseWidgets.length >= Math.max(2, Math.ceil(widgets.length / 3))
  const isDenseTab = widgets.length >= 9

  const recommendations: string[] = []
  if (duplicateTypes.length > 0) {
    recommendations.push(
      `Duplicate widgets detected: ${duplicateTypes.map((entry) => `${prettifyWidgetType(entry.type)} x${entry.count}`).join(', ')}.`
    )
  }
  if (undersizedWidgets.length > 0) {
    recommendations.push(
      `${undersizedWidgets.length} widget${undersizedWidgets.length === 1 ? '' : 's'} are below their recommended height and may clip content.`
    )
  }
  if (isDeadTab) {
    recommendations.push(
      `${compactedSparseWidgets.length} widget${compactedSparseWidgets.length === 1 ? '' : 's'} are compacted into sparse or empty states, so this tab may be carrying dead space.`
    )
  }
  if (isDenseTab) {
    recommendations.push('This tab is dense enough that a focused analyst or compact preset would improve readability.')
  }

  return {
    duplicateTypes,
    compactedSparseWidgets,
    undersizedWidgets,
    recommendations,
    isDeadTab,
    isDenseTab,
  }
}
