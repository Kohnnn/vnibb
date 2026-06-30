import { fireEvent, render, screen, within } from '@testing-library/react'

import { Sidebar } from '@/components/layout/Sidebar'
import { useDashboard } from '@/contexts/DashboardContext'
import type {
  Dashboard,
  DashboardFolder,
  DashboardTab,
  WidgetInstance,
  WidgetSyncGroup,
} from '@/types/dashboard'

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: jest.fn(),
}))

jest.mock('@/components/settings/SettingsModal', () => ({
  SettingsModal: () => null,
}))

jest.mock('@/lib/analytics', () => ({
  ANALYTICS_EVENTS: {
    settingsOpened: 'settings_opened',
    sidebarCollapsedToggled: 'sidebar_collapsed_toggled',
    workspaceDuplicated: 'workspace_duplicated',
  },
  captureAnalyticsEvent: jest.fn(),
}))

const mockUseDashboard = jest.mocked(useDashboard)

function makeTab(id: string): DashboardTab {
  return {
    id,
    name: 'Overview',
    order: 0,
    widgets: [],
  }
}

function makeDashboard(id: string, name: string, order: number): Dashboard {
  return {
    id,
    name,
    order,
    isDefault: false,
    isEditable: true,
    isDeletable: true,
    showGroupLabels: true,
    tabs: [makeTab(`${id}-tab`)],
    syncGroups: [],
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
  }
}

function renderSidebarWithDashboards(dashboards: readonly [Dashboard, Dashboard]): void {
  const firstDashboard = dashboards[0]
  const firstTab = firstDashboard.tabs[0] ?? null
  const emptyFolders: DashboardFolder[] = []
  const fallbackWidget: WidgetInstance = {
    id: 'widget-1',
    type: 'ticker_info',
    tabId: firstTab?.id ?? 'tab-1',
    config: {},
    layout: { i: 'widget-1', x: 0, y: 0, w: 1, h: 1 },
  }
  const fallbackSyncGroup: WidgetSyncGroup = {
    id: 1,
    name: 'Group 1',
    color: '#3B82F6',
    currentSymbol: 'VNM',
  }

  mockUseDashboard.mockReturnValue({
    state: {
      dashboards: [...dashboards],
      folders: emptyFolders,
      activeDashboardId: firstDashboard.id,
      activeTabId: firstTab?.id ?? null,
    },
    setActiveDashboard: jest.fn(),
    createDashboard: () => firstDashboard,
    updateDashboard: jest.fn(),
    updateDashboardRuntime: jest.fn(),
    deleteDashboard: jest.fn(),
    createFolder: (name: string) => ({
      id: 'folder-1',
      name,
      order: 0,
      isExpanded: true,
    }),
    updateFolder: jest.fn(),
    deleteFolder: jest.fn(),
    toggleFolder: jest.fn(),
    setActiveTab: jest.fn(),
    createTab: () => makeTab('created-tab'),
    updateTab: jest.fn(),
    deleteTab: jest.fn(),
    reorderTabs: jest.fn(),
    restoreLastClosedTab: () => null,
    recentlyClosedTabs: [],
    applyTemplate: jest.fn(),
    addWidget: () => fallbackWidget,
    updateWidget: jest.fn(),
    updateWidgetRuntime: jest.fn(),
    deleteWidget: jest.fn(),
    cloneWidget: () => null,
    updateTabLayout: jest.fn(),
    resetTabLayout: jest.fn(),
    updateSyncGroupSymbol: jest.fn(),
    createSyncGroup: () => fallbackSyncGroup,
    setDashboardAdminUnlocked: jest.fn(),
    moveDashboard: jest.fn(),
    reorderDashboards: jest.fn(),
    activeDashboard: firstDashboard,
    activeTab: firstTab,
    migrationNotice: null,
    dismissMigrationNotice: jest.fn(),
    backendSync: {
      enabled: false,
      status: 'idle',
      loadPaused: false,
    },
    availableTemplates: [],
  })

  render(<Sidebar />)
}

describe('Sidebar context menu accessibility', () => {
  beforeEach(() => {
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = jest.fn()
  })

  test('renders workspace actions inside a menu with menuitem children', () => {
    // Given: two editable custom workspaces in the root sidebar.
    renderSidebarWithDashboards([
      makeDashboard('workspace-1', 'First Workspace', 0),
      makeDashboard('workspace-2', 'Second Workspace', 1),
    ])

    // When: the user opens the context menu for a custom workspace.
    fireEvent.contextMenu(screen.getByText('First Workspace'))

    // Then: the menu and its actions expose ARIA menu semantics.
    const menu = screen.getByRole('menu', { name: 'Workspace actions' })
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toBeInTheDocument()
  })

  test('keeps top-bound Move up visible and explicitly disabled for assistive tech', () => {
    // Given: the first custom workspace is already at the top of its folder.
    renderSidebarWithDashboards([
      makeDashboard('workspace-1', 'First Workspace', 0),
      makeDashboard('workspace-2', 'Second Workspace', 1),
    ])

    // When: the context menu opens for that top-bound workspace.
    fireEvent.contextMenu(screen.getByText('First Workspace'))

    // Then: Move up remains discoverable but unavailable.
    const menu = screen.getByRole('menu', { name: 'Workspace actions' })
    const moveUp = within(menu).getByRole('menuitem', { name: 'Move up' })
    expect(moveUp).toBeVisible()
    expect(moveUp).toBeDisabled()
    expect(moveUp).toHaveAttribute('aria-disabled', 'true')
  })
})
