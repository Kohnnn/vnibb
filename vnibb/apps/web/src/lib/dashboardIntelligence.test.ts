import { analyzeDashboardTab, getWidgetLayoutInsight } from '@/lib/dashboardIntelligence'
import type { WidgetInstance, WidgetType } from '@/types/dashboard'

function makeWidget(id: string, type: WidgetType, h: number, minH = 6): WidgetInstance {
  return {
    id,
    type,
    tabId: 'tab-1',
    config: {},
    layout: {
      i: id,
      x: 0,
      y: 0,
      w: 8,
      h,
      minW: 4,
      minH,
    },
  }
}

describe('dashboard intelligence', () => {
  test('flags compacted sparse widgets when current height falls below minH', () => {
    const insight = getWidgetLayoutInsight(makeWidget('w1', 'relative_rotation', 5, 8))

    expect(insight).toEqual(expect.objectContaining({
      kind: 'compacted_sparse',
      severity: 'warning',
    }))
  })

  test('flags undersized widgets when current height is materially below preferred height', () => {
    const insight = getWidgetLayoutInsight(makeWidget('w2', 'market_breadth', 8, 7))

    expect(insight).toEqual(expect.objectContaining({
      kind: 'undersized',
      severity: 'info',
    }))
  })

  test('detects duplicates, dense tabs, and dead-tab heuristics', () => {
    const widgets = [
      makeWidget('a', 'rs_ranking', 8, 6),
      makeWidget('b', 'rs_ranking', 8, 6),
      makeWidget('c', 'relative_rotation', 5, 8),
      makeWidget('d', 'transaction_flow', 5, 6),
      makeWidget('e', 'market_breadth', 8, 7),
      makeWidget('f', 'top_movers', 9, 6),
      makeWidget('g', 'sector_board', 15, 12),
      makeWidget('h', 'market_overview', 8, 5),
      makeWidget('i', 'industry_bubble', 12, 9),
    ]

    const intelligence = analyzeDashboardTab(widgets)

    expect(intelligence.duplicateTypes).toEqual([
      expect.objectContaining({ type: 'rs_ranking', count: 2 }),
    ])
    expect(intelligence.isDenseTab).toBe(true)
    expect(intelligence.isDeadTab).toBe(false)
    expect(intelligence.recommendations.length).toBeGreaterThan(0)
  })
})
