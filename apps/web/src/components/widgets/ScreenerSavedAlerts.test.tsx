import type { Dashboard } from '@/types/dashboard'
import {
  buildSavedScreenAlertId,
  canProcessScreenerAlert,
  getNewScreenerMatchSymbols,
  getScreenerMatchSymbols,
  getScreenerWatchlistTargets,
  isSavedScreenScanCurrent,
  shouldRescheduleScreenerAlertPoll,
  shouldResumeScreenerAlertPoll,
  resolveScreenerWatchlistAction,
} from './ScreenerWidget'

const savedScreen = {
  id: 'quality',
  name: 'Quality',
  quickFilters: [{ id: 'roe', value: { gte: 15 }, displayValue: 'ROE >= 15%' }],
  advancedFilters: null,
  columns: ['ticker'],
  sortField: 'roe',
  sortOrder: 'desc' as const,
  market: 'HOSE',
}

describe('saved screener alerts', () => {
  test('selects unambiguous watchlist paths', () => {
    expect(resolveScreenerWatchlistAction(0)).toBe('create')
    expect(resolveScreenerWatchlistAction(1)).toBe('direct')
    expect(resolveScreenerWatchlistAction(2)).toBe('choose')
  })

  test('excludes protected system dashboards from watchlist targets', () => {
    const dashboard = (id: string, name: string): Dashboard => ({
      id,
      name,
      order: 0,
      isDefault: false,
      showGroupLabels: true,
      tabs: [{
        id: `${id}-tab`,
        name: 'Overview',
        order: 0,
        widgets: [{
          id: `${id}-watchlist`,
          type: 'watchlist',
          tabId: `${id}-tab`,
          config: {},
          layout: { i: `${id}-watchlist`, x: 0, y: 0, w: 4, h: 4 },
        }],
      }],
      syncGroups: [],
      createdAt: '',
      updatedAt: '',
    })

    expect(getScreenerWatchlistTargets([
      dashboard('default-fundamental', 'Fundamental'),
      dashboard('investor-workflow', 'Investor Workflow'),
    ])).toEqual([
      expect.objectContaining({
        dashboardId: 'investor-workflow',
        widgetId: 'investor-workflow-watchlist',
      }),
    ])
  })

  test('creates a fresh activity ID when a symbol re-enters later', () => {
    expect(buildSavedScreenAlertId('quality', ['FPT'], '2026-07-21T01:00:00.000Z'))
      .not.toBe(buildSavedScreenAlertId('quality', ['FPT'], '2026-07-21T02:00:00.000Z'))
  })

  test('evaluates all scan matches independently of quick search', () => {
    const scanRows = [{ ticker: 'FPT' }, { symbol: 'VNM' }]
    const quickSearchRows = [{ ticker: 'FPT' }]

    expect(getScreenerMatchSymbols(scanRows)).toEqual(['FPT', 'VNM'])
    expect(getNewScreenerMatchSymbols(['FPT'], scanRows)).toEqual(['VNM'])
    expect(getScreenerMatchSymbols(quickSearchRows)).toEqual(['FPT'])
  })

  test('suppresses alert processing while hidden or offline', () => {
    expect(canProcessScreenerAlert(false, true)).toBe(true)
    expect(canProcessScreenerAlert(true, true)).toBe(false)
    expect(canProcessScreenerAlert(false, false)).toBe(false)
  })

  test('does not reschedule a completed poll after cancellation', () => {
    expect(shouldRescheduleScreenerAlertPoll(false, false, true)).toBe(true)
    expect(shouldRescheduleScreenerAlertPoll(true, false, true)).toBe(false)
    expect(shouldRescheduleScreenerAlertPoll(false, true, true)).toBe(false)
    expect(shouldRescheduleScreenerAlertPoll(false, false, false)).toBe(false)
  })

  test('resumes only current enabled saved scans when visible and online', () => {
    expect(shouldResumeScreenerAlertPoll(false, false, true, true, true)).toBe(true)
    expect(shouldResumeScreenerAlertPoll(false, true, true, true, true)).toBe(false)
    expect(shouldResumeScreenerAlertPoll(false, false, false, true, true)).toBe(false)
    expect(shouldResumeScreenerAlertPoll(false, false, true, false, true)).toBe(false)
    expect(shouldResumeScreenerAlertPoll(false, false, true, true, false)).toBe(false)
  })

  test('requires the active scan to still match the saved screen', () => {
    expect(isSavedScreenScanCurrent(
      savedScreen,
      savedScreen.quickFilters,
      { logic: 'AND', conditions: [] },
      'roe',
      'desc',
      'HOSE',
    )).toBe(true)

    expect(isSavedScreenScanCurrent(
      savedScreen,
      [],
      { logic: 'AND', conditions: [] },
      'roe',
      'desc',
      'HOSE',
    )).toBe(false)
  })

  test('keeps index universes in saved screens', () => {
    expect(isSavedScreenScanCurrent(
      { ...savedScreen, market: 'VN30' },
      savedScreen.quickFilters,
      { logic: 'AND', conditions: [] },
      'roe',
      'desc',
      'VN30',
    )).toBe(true)
  })
})
