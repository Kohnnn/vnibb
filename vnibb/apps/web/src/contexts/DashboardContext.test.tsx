import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext'
import { useDashboardSync, useLoadFromBackend } from '@/lib/useDashboardSync'

jest.mock('@/lib/useDashboardSync', () => ({
  useDashboardSync: jest.fn(),
  useLoadFromBackend: jest.fn(),
}))

jest.mock('@/components/widgets/WidgetRegistry', () => ({
  defaultWidgetLayouts: {},
}))

function DashboardHarness() {
  const {
    state,
    activeDashboard,
    activeTab,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    createTab,
    setActiveDashboard,
    updateSyncGroupSymbol,
  } = useDashboard()

  const latestDashboard = state.dashboards[state.dashboards.length - 1]

  return (
    <div>
      <div data-testid="dash-count">{state.dashboards.length}</div>
      <div data-testid="folder-count">{state.folders.length}</div>
      <div data-testid="folder-names">{state.folders.map((folder) => folder.name).join('|')}</div>
      <div data-testid="active-name">{activeDashboard?.name || ''}</div>
      <div data-testid="active-tab-name">{activeTab?.name || ''}</div>
      <div data-testid="tab-count">{activeDashboard?.tabs.length || 0}</div>
      <div data-testid="tab-names">{(activeDashboard?.tabs || []).map((tab) => tab.name).join('|')}</div>
      <div data-testid="sync-symbol">{activeDashboard?.syncGroups?.[0]?.currentSymbol || ''}</div>

      <button
        onClick={() => {
          const dashboard = createDashboard({ name: 'Test Dashboard' })
          setActiveDashboard(dashboard.id)
        }}
      >
        Create Dashboard
      </button>

      <button
        onClick={() => {
          if (latestDashboard) {
            updateDashboard(latestDashboard.id, { name: 'Renamed Dashboard' })
          }
        }}
      >
        Rename Latest
      </button>

      <button
        onClick={() => {
          if (latestDashboard) {
            deleteDashboard(latestDashboard.id)
          }
        }}
      >
        Delete Latest
      </button>

      <button
        onClick={() => {
          if (activeDashboard) {
            createTab(activeDashboard.id, 'New Tab')
          }
        }}
      >
        Create Tab
      </button>

      <button
        onClick={() => {
          if (activeDashboard) {
            updateSyncGroupSymbol(activeDashboard.id, 1, 'FPT')
          }
        }}
      >
        Set Sync Symbol
      </button>
    </div>
  )
}

function renderDashboardHarness() {
  return render(
    <DashboardProvider>
      <DashboardHarness />
    </DashboardProvider>
  )
}

const mockedUseDashboardSync = useDashboardSync as jest.MockedFunction<typeof useDashboardSync>
const mockedUseLoadFromBackend = useLoadFromBackend as jest.MockedFunction<typeof useLoadFromBackend>

describe('DashboardContext integration', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockedUseDashboardSync.mockImplementation(() => undefined)
    mockedUseLoadFromBackend.mockImplementation(() => undefined)
  })

  test('initializes with a default dashboard', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })

    expect(screen.getByTestId('folder-names')).toHaveTextContent('Initial')
    expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
  })

  test('uses the stored default tab when the main dashboard loads', async () => {
    window.localStorage.setItem(
      'vnibb-user-preferences',
      JSON.stringify({ defaultTicker: 'VCI', defaultTab: 'fundamentals' })
    )

    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
    })

    expect(screen.getByTestId('active-tab-name')).toHaveTextContent('Fundamentals')
  })

  test('uses technical preference to open the technical workspace first', async () => {
    window.localStorage.setItem(
      'vnibb-user-preferences',
      JSON.stringify({ defaultTicker: 'VCI', defaultTab: 'technical' })
    )

    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Technical')
    })

    expect(screen.getByTestId('active-tab-name')).toHaveTextContent('Technical')
  })

  test('restores the last active dashboard and tab from local storage', async () => {
    const firstRender = renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
    })

    const storedDashboards = JSON.parse(window.localStorage.getItem('vnibb_dashboards') || '[]')
    const targetDashboard = storedDashboards.find((dashboard: { name: string }) => dashboard.name === 'Technical')
    const targetTab = targetDashboard?.tabs?.find((tab: { name: string }) => tab.name === 'Technical')

    window.localStorage.setItem(
      'vnibb-dashboard-last-view',
      JSON.stringify({
        activeDashboardId: targetDashboard?.id,
        lastActiveTabIdByDashboard: {
          [targetDashboard?.id]: targetTab?.id,
        },
      })
    )

    firstRender.unmount()
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Technical')
    })

    expect(screen.getByTestId('active-tab-name')).toHaveTextContent('Technical')
  })

  test('initial folder provisions the core dashboards plus global markets workspace', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('folder-count')).toHaveTextContent('1')
    })

    expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
    expect(screen.getByTestId('tab-names')).toHaveTextContent(
      'Fundamentals|Overview|Company|Ownership|Comparison|News & Events'
    )
  })

  test('hydrates remote dashboards when local storage only has system defaults', async () => {
    mockedUseLoadFromBackend.mockImplementation((onLoad, enabled = true) => {
      useEffect(() => {
        if (!enabled) {
          return
        }

        onLoad([
          {
            id: '101',
            name: 'Cloud Dashboard',
            description: 'Loaded from Supabase',
            order: 1,
            isDefault: false,
            isEditable: true,
            isDeletable: true,
            showGroupLabels: true,
            tabs: [{ id: 'tab-remote', name: 'Overview', order: 0, widgets: [] }],
            syncGroups: [{ id: 1, name: 'Group 1', color: '#3B82F6', currentSymbol: 'FPT' }],
            createdAt: '2026-04-06T00:00:00.000Z',
            updatedAt: '2026-04-06T00:00:00.000Z',
          },
        ])
      }, [enabled, onLoad])
    })

    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('5')
    })

    const storedDashboards = JSON.parse(window.localStorage.getItem('vnibb_dashboards') || '[]')
    expect(storedDashboards.some((dashboard: { id: string; name: string }) => dashboard.id === '101' && dashboard.name === 'Cloud Dashboard')).toBe(true)
  })

  test('createDashboard adds a dashboard and activates it', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Dashboard' }))

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('5')
    })
    expect(screen.getByTestId('active-name')).toHaveTextContent('Test Dashboard')
  })

  test('does not delete immutable main dashboard', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Latest' }))

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })
    expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
  })

  test('updateDashboard renames the latest dashboard', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Dashboard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename Latest' }))

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Renamed Dashboard')
    })
  })

  test('deleteDashboard removes the latest dashboard', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Dashboard' }))

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('5')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Latest' }))

    await waitFor(() => {
      expect(screen.getByTestId('dash-count')).toHaveTextContent('4')
    })
  })

  test('createTab adds a new tab to active dashboard', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(Number(screen.getByTestId('tab-count').textContent || '0')).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Dashboard' }))

    let activeTabCountBeforeCreate = 0
    await waitFor(() => {
      activeTabCountBeforeCreate = Number(screen.getByTestId('tab-count').textContent || '0')
      expect(activeTabCountBeforeCreate).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Tab' }))

    await waitFor(() => {
      expect(screen.getByTestId('tab-count')).toHaveTextContent(
        String(activeTabCountBeforeCreate + 1)
      )
    })
  })

  test('locked system dashboards still accept sync symbol updates', async () => {
    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
    })

    expect(screen.getByTestId('sync-symbol')).toHaveTextContent('VCI')
    fireEvent.click(screen.getByRole('button', { name: 'Set Sync Symbol' }))
    expect(screen.getByTestId('sync-symbol')).toHaveTextContent('FPT')
  })

  test('migrates legacy New Dashboard names on load', async () => {
    window.localStorage.setItem(
      'vnibb_dashboards',
      JSON.stringify([
        {
          id: 'dash-legacy',
          name: 'New Dashboard',
          description: null,
          order: 0,
          isDefault: false,
          showGroupLabels: true,
          tabs: [{ id: 'tab-1', name: 'Overview', order: 0, widgets: [] }],
          syncGroups: [{ id: 1, name: 'Group 1', color: '#2563eb', currentSymbol: 'VNM' }],
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ])
    )
    window.localStorage.setItem('vnibb_folders', JSON.stringify([]))
    window.localStorage.setItem('vnibb_migration_version', '2')

    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
    })

    expect(screen.getByTestId('dash-count')).toHaveTextContent('5')
    expect(screen.getByTestId('folder-names')).toHaveTextContent('Initial')

    expect(window.localStorage.getItem('vnibb_migration_version')).toBe('20')
  })

  test('migrates legacy widget aliases to canonical widget types on load', async () => {
    window.localStorage.setItem(
      'vnibb_dashboards',
      JSON.stringify([
        {
          id: 'dash-legacy-widgets',
          name: 'Legacy Widgets',
          description: null,
          order: 0,
          isDefault: false,
          showGroupLabels: true,
          tabs: [{
            id: 'tab-legacy',
            name: 'Overview',
            order: 0,
            widgets: [
              {
                id: 'widget-company-profile',
                type: 'company_profile',
                tabId: 'tab-legacy',
                config: {},
                layout: { i: 'widget-company-profile', x: 0, y: 0, w: 4, h: 4, minW: 9, minH: 7, maxW: 14 },
              },
              {
                id: 'widget-financials',
                type: 'financials',
                tabId: 'tab-legacy',
                config: {},
                layout: { i: 'widget-financials', x: 4, y: 0, w: 4, h: 4, minW: 20, minH: 15, maxW: 24 },
              },
              {
                id: 'widget-ownership',
                type: 'institutional_ownership',
                tabId: 'tab-legacy',
                config: {},
                layout: { i: 'widget-ownership', x: 8, y: 0, w: 4, h: 4, minW: 10, minH: 6, maxW: 12 },
              },
              {
                id: 'widget-db-browser',
                type: 'database_browser',
                tabId: 'tab-legacy',
                config: {},
                layout: { i: 'widget-db-browser', x: 12, y: 0, w: 4, h: 4, minW: 8, minH: 8, maxW: 12 },
              },
            ],
          }],
          syncGroups: [{ id: 1, name: 'Group 1', color: '#2563eb', currentSymbol: 'VNM' }],
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ])
    )
    window.localStorage.setItem('vnibb_folders', JSON.stringify([]))
    window.localStorage.setItem('vnibb_migration_version', '15')

    renderDashboardHarness()

    await waitFor(() => {
      expect(screen.getByTestId('active-name')).toHaveTextContent('Fundamental')
    })

    const storedDashboards = JSON.parse(window.localStorage.getItem('vnibb_dashboards') || '[]')
    const migratedDashboard = storedDashboards.find((dashboard: { id: string }) => dashboard.id === 'dash-legacy-widgets')
    const migratedWidgetTypes = migratedDashboard?.tabs?.[0]?.widgets?.map((widget: { type: string }) => widget.type) || []

    expect(migratedWidgetTypes).toEqual([
      'ticker_profile',
      'unified_financials',
      'major_shareholders',
      'database_inspector',
    ])
    expect(migratedDashboard.tabs[0].widgets[0].layout.minW).toBe(6)
    expect(migratedDashboard.tabs[0].widgets[0].layout.minH).toBe(4)
    expect(migratedDashboard.tabs[0].widgets[0].layout.maxW).toBeUndefined()
    expect(migratedDashboard.tabs[0].widgets[1].layout.minW).toBe(16)
    expect(migratedDashboard.tabs[0].widgets[1].layout.minH).toBe(12)
    expect(migratedDashboard.tabs[0].widgets[1].layout.maxW).toBeUndefined()
  })
})
