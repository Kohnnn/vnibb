import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ScreenerResponse } from '@/types/screener'
import { useScreenerData } from '@/lib/queries'
import { recordAlertActivity } from '@/lib/alertActivity'
import { ScreenerWidget } from './ScreenerWidget'

jest.mock('@/lib/queries', () => ({
  useScreenerData: jest.fn(),
  useVnstockSource: () => 'KBS',
}))
jest.mock('@/lib/alertActivity', () => ({ recordAlertActivity: jest.fn() }))
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({
    state: { dashboards: [] },
    activeDashboard: null,
    activeTab: null,
    addWidget: jest.fn(),
    createDashboard: jest.fn(),
    createTab: jest.fn(),
    updateWidget: jest.fn(),
  }),
}))
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }))
jest.mock('@/components/ui/WidgetContainer', () => ({ WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))
jest.mock('@/components/ui/VirtualizedTable', () => ({ VirtualizedTable: () => <div>Stocks table</div> }))

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

const mockedScreenerQuery = jest.mocked(useScreenerData)
const mockedRecordAlertActivity = jest.mocked(recordAlertActivity)

function setScan(data: ScreenerResponse) {
  mockedScreenerQuery.mockReturnValue({
    data,
    error: null,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  } as unknown as UseQueryResult<ScreenerResponse, Error>)
}

describe('screener availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('shows retry for an outage, but reset filters for a genuine zero-match scan', () => {
    const refetch = jest.fn()
    mockedScreenerQuery.mockReturnValue({
      data: { data: [], error: 'Screener data is temporarily unavailable.', meta: { availability: 'unavailable' } },
      error: null,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: 0,
      refetch,
    } as unknown as UseQueryResult<ScreenerResponse, Error>)

    const widget = render(<ScreenerWidget id="screen-test" />)
    expect(screen.getByText('Screener unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No stocks match your filters.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(refetch).toHaveBeenCalled()

    setScan({ data: [], error: null, meta: { availability: 'available' } })
    widget.rerender(<ScreenerWidget id="screen-test" />)
    expect(screen.getByText('No stocks match your filters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument()
  })

  test('does not replace a saved-screen baseline during outage', async () => {
    const saved = { ...savedScreen, alertEnabled: true, alertMatchSymbols: ['VNM'] }
    const config = {
      savedScreens: [saved],
      activeScreenId: saved.id,
      quickFilters: saved.quickFilters,
      sortField: saved.sortField,
      sortOrder: saved.sortOrder,
      market: saved.market,
    }
    setScan({ data: [], error: 'Screener unavailable', meta: { availability: 'unavailable' } })
    const widget = render(<ScreenerWidget id="screen-alert" config={config} />)
    expect(mockedRecordAlertActivity).not.toHaveBeenCalled()

    setScan({ data: [{ ticker: 'VNM' }, { ticker: 'FPT' }], meta: { availability: 'available' } })
    widget.rerender(<ScreenerWidget id="screen-alert" config={config} />)
    await waitFor(() => expect(mockedRecordAlertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'FPT' }),
    ))
  })
})
