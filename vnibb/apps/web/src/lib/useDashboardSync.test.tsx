import { act, render, waitFor } from '@testing-library/react'

import { useDashboardSync } from '@/lib/useDashboardSync'
import type { DashboardState } from '@/types/dashboard'

jest.mock('@/lib/backendHealth', () => ({
  probeBackendReadiness: jest.fn(),
}))

jest.mock('@/lib/api', () => ({
  createDashboard: jest.fn(),
  updateDashboard: jest.fn(),
  deleteDashboard: jest.fn(),
  getDashboards: jest.fn(),
}))

const { probeBackendReadiness } = jest.requireMock('@/lib/backendHealth') as {
  probeBackendReadiness: jest.Mock
}

const api = jest.requireMock('@/lib/api') as {
  createDashboard: jest.Mock
  updateDashboard: jest.Mock
  deleteDashboard: jest.Mock
}

function buildState(dashboards: DashboardState['dashboards']): DashboardState {
  return {
    dashboards,
    folders: [],
    activeDashboardId: dashboards[0]?.id || null,
    activeTabId: dashboards[0]?.tabs[0]?.id || null,
  }
}

function SyncHarness({
  state,
  onDashboardIdReconciled,
}: {
  state: DashboardState
  onDashboardIdReconciled?: (localId: string, dashboard: DashboardState['dashboards'][number]) => void
}) {
  useDashboardSync(state, {
    enabled: true,
    onDashboardIdReconciled,
  })

  return null
}

describe('useDashboardSync', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    probeBackendReadiness.mockResolvedValue({ healthOk: true, dataOk: true })
    api.createDashboard.mockResolvedValue({
      id: 101,
      name: 'Cloud Dashboard',
      description: 'Saved remotely',
      is_default: false,
      layout_config: {
        tabs: [{ id: 'tab-local', name: 'Overview', order: 0, widgets: [] }],
        syncGroups: [{ id: 1, name: 'Group 1', color: '#3B82F6', currentSymbol: 'FPT' }],
        showGroupLabels: true,
        order: 0,
      },
      created_at: '2026-04-06T00:00:00.000Z',
      updated_at: '2026-04-06T00:00:00.000Z',
    })
    api.updateDashboard.mockResolvedValue(undefined)
    api.deleteDashboard.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('creates backend dashboards for new local dashboards and reconciles the numeric id', async () => {
    const onDashboardIdReconciled = jest.fn()
    const state = buildState([
      {
        id: 'dash-local-1',
        name: 'Cloud Dashboard',
        description: 'Saved remotely',
        order: 0,
        isDefault: false,
        showGroupLabels: true,
        tabs: [{ id: 'tab-local', name: 'Overview', order: 0, widgets: [] }],
        syncGroups: [{ id: 1, name: 'Group 1', color: '#3B82F6', currentSymbol: 'FPT' }],
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
      },
    ])

    render(<SyncHarness state={state} onDashboardIdReconciled={onDashboardIdReconciled} />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(api.createDashboard).toHaveBeenCalledTimes(1)
    })

    expect(api.createDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cloud Dashboard',
        is_default: false,
        layout_config: expect.objectContaining({
          tabs: state.dashboards[0].tabs,
          syncGroups: state.dashboards[0].syncGroups,
        }),
      })
    )
    expect(onDashboardIdReconciled).toHaveBeenCalledWith(
      'dash-local-1',
      expect.objectContaining({ id: '101', name: 'Cloud Dashboard' })
    )
  })

  test('deletes removed numeric dashboards from the backend', async () => {
    const startingState = buildState([
      {
        id: '101',
        name: 'Persisted Dashboard',
        description: 'Backed by Supabase',
        order: 0,
        isDefault: false,
        showGroupLabels: true,
        tabs: [{ id: 'tab-1', name: 'Overview', order: 0, widgets: [] }],
        syncGroups: [{ id: 1, name: 'Group 1', color: '#3B82F6', currentSymbol: 'VNM' }],
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
      },
    ])

    const { rerender } = render(<SyncHarness state={startingState} />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    api.deleteDashboard.mockClear()

    rerender(<SyncHarness state={buildState([])} />)

    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(api.deleteDashboard).toHaveBeenCalledWith(101)
    })
  })
})
