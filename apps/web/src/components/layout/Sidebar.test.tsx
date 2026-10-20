import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { Sidebar } from '@/components/layout/Sidebar'
import { useDashboard } from '@/contexts/DashboardContext'
import { createWorkspaceBackup } from '@/lib/workspaceBackup'
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

jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ getSharedGroups: jest.fn() }),
}))
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({
  useGlobalMarketsSymbol: () => ({ appGlobalMarketsSymbol: 'AMEX:SPY' }),
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

function renderSidebarWithDashboards(
  dashboards: readonly [Dashboard, Dashboard],
  folders: DashboardFolder[] = [],
): void {
  const firstDashboard = dashboards[0]
  const firstTab = firstDashboard.tabs[0] ?? null
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
    localStateReady: true,
    userNavigationSeq: 0,
    state: {
      dashboards: [...dashboards],
      folders,
      activeDashboardId: firstDashboard.id,
      activeTabId: firstTab?.id ?? null,
    },
    setActiveDashboard: jest.fn(),
    createDashboard: () => firstDashboard,
    exportWorkspace: jest.fn(),
    restoreWorkspace: jest.fn(),
    importResearchBundle: jest.fn(),
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

  test('opens backup restore without changing the active workspace', () => {
    renderSidebarWithDashboards([
      makeDashboard('workspace-1', 'First Workspace', 0),
      makeDashboard('workspace-2', 'Second Workspace', 1),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Backup workspaces' }))
    expect(screen.getByRole('dialog', { name: 'Backup and restore workspaces' })).toBeInTheDocument()
    expect(mockUseDashboard().setActiveDashboard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close backup dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('reopens a clean backup session and ignores a file still reading when it closed', async () => {
    renderSidebarWithDashboards([
      makeDashboard('workspace-1', 'First Workspace', 0),
      makeDashboard('workspace-2', 'Second Workspace', 1),
    ])
    const oldBackup = createWorkspaceBackup({
      dashboards: [makeDashboard('old-backup', 'Old backup', 0)],
      folders: [], activeDashboardId: null, activeTabId: null,
    })
    const currentBackup = createWorkspaceBackup({
      dashboards: [makeDashboard('current-backup', 'Current backup', 0)],
      folders: [], activeDashboardId: null, activeTabId: null,
    })
    let finishOldRead!: (text: string) => void
    const oldRead = new Promise<string>((resolve) => { finishOldRead = resolve })
    const oldFile = new File([''], 'old.json', { type: 'application/json' })
    Object.defineProperty(oldFile, 'text', { value: () => oldRead })
    fireEvent.click(screen.getByRole('button', { name: 'Backup workspaces' }))
    fireEvent.change(screen.getByLabelText('Restore from a backup file (up to 5 MB)'), { target: { files: [oldFile] } })
    expect(screen.getByLabelText('Restore from a backup file (up to 5 MB)')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Close backup dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Backup workspaces' }))
    const input = screen.getByLabelText('Restore from a backup file (up to 5 MB)')
    expect(input).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    const currentFile = new File([''], 'current.json', { type: 'application/json' })
    Object.defineProperty(currentFile, 'text', { value: () => Promise.resolve(JSON.stringify(currentBackup)) })
    fireEvent.change(input, { target: { files: [currentFile] } })
    await screen.findByText('Dashboards: Current backup')
    await act(async () => { finishOldRead(JSON.stringify(oldBackup)) })

    expect(screen.getByText('Dashboards: Current backup')).toBeInTheDocument()
    expect(screen.queryByText('Dashboards: Old backup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close backup dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Backup workspaces' }))
    expect(screen.queryByText('Import preview')).not.toBeInTheDocument()
    expect(mockUseDashboard().restoreWorkspace).not.toHaveBeenCalled()
    expect(mockUseDashboard().setActiveDashboard).not.toHaveBeenCalled()
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
  test('keeps Space available to workspace name inputs', () => {
    renderSidebarWithDashboards([
      makeDashboard('workspace-1', 'First Workspace', 0),
      makeDashboard('workspace-2', 'Second Workspace', 1),
    ])

    fireEvent.doubleClick(screen.getByText('First Workspace'))
    const input = screen.getByRole('textbox', { name: 'Dashboard name' })
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(mockUseDashboard().setActiveDashboard).not.toHaveBeenCalled()
  })

  test('does not intercept Space on the workspace actions control', () => {
    renderSidebarWithDashboards([
      makeDashboard('workspace-1', 'First Workspace', 0),
      makeDashboard('workspace-2', 'Second Workspace', 1),
    ])

    const actions = screen.getByRole('button', { name: 'Workspace actions for First Workspace' })
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    actions.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(mockUseDashboard().setActiveDashboard).not.toHaveBeenCalled()
  })
  test('keeps Space available to folder name inputs', () => {
    const folder: DashboardFolder = {
      id: 'folder-custom',
      name: 'Research',
      order: 0,
      isExpanded: true,
    }
    renderSidebarWithDashboards(
      [makeDashboard('workspace-1', 'First Workspace', 0), makeDashboard('workspace-2', 'Second Workspace', 1)],
      [folder],
    )

    fireEvent.contextMenu(screen.getByText('Research'))
    const menu = screen.getByRole('menu', { name: 'Folder actions' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Folder name' })
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(mockUseDashboard().toggleFolder).not.toHaveBeenCalled()
  })
})
