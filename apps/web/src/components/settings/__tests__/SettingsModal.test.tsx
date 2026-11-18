jest.mock('@/contexts/AuthContext', () => {
  const value = { user: null, isAdmin: false, adminStatus: 'signed-out', adminError: null, refreshAdminSession: jest.fn() }
  return { useAuth: () => value }
})
jest.mock('@/contexts/DataSourcesContext', () => {
  const value = { preferredVnstockSource: 'VCI', setPreferredVnstockSource: jest.fn() }
  return { useDataSources: () => value }
})
jest.mock('@/contexts/ThemeContext', () => {
  const value = { theme: 'dark', setTheme: jest.fn(), resolvedTheme: 'dark' }
  return { useTheme: () => value }
})
jest.mock('@/contexts/UnitContext', () => {
  const value = { config: { display: 'auto', decimalPlaces: 2, usdVndRatesByYear: { '2024': 25_000, '2025': 30_000, '2026': 32_000 } }, globalUsdVndDefaultRate: 28_000, adminUsdVndRatesByYear: { '2025': 30_000 }, localUsdVndRatesByYear: { '2026': 32_000 }, setUnit: jest.fn(), setDecimalPlaces: jest.fn(), setUsdVndRate: jest.fn(), clearUsdVndRates: jest.fn(), applyAdminUsdRuntimeConfig: jest.fn() }
  return { useUnit: () => value }
})
jest.mock('@/contexts/SymbolLinkContext', () => {
  const value = { globalSymbol: 'VNM', setGlobalSymbol: jest.fn() }
  return { useSymbolLink: () => value }
})
jest.mock('@/contexts/WidgetGroupContext', () => {
  const value = { setGlobalSymbol: jest.fn() }
  return { useWidgetGroups: () => value }
})
jest.mock('@/contexts/DashboardContext', () => {
  const { createContext } = jest.requireActual<typeof import('react')>('react')
  const value = { state: { dashboards: [], folders: [] }, activeDashboard: null, setActiveDashboard: jest.fn(), setActiveTab: jest.fn() }
  return { DashboardContext: createContext(null), useDashboard: () => value }
})
jest.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: jest.fn() }))
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }))
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  getInsiderAlerts: jest.fn(),
  getScreenerData: jest.fn(),
  markAlertRead: jest.fn(),
}))

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ContextType } from 'react'

import { SettingsModal } from '../SettingsModal'
import { AlertNotificationPanel } from '@/components/widgets/AlertNotificationPanel'
import { PriceAlertsWidget } from '@/components/widgets/PriceAlertsWidget'
import { ScreenerWidget } from '@/components/widgets/ScreenerWidget'
import { DashboardContext } from '@/contexts/DashboardContext'
import { UiPreferencesProvider, useUiPreferences } from '@/contexts/UiPreferencesContext'
import { getInsiderAlerts, getScreenerData } from '@/lib/api'
import { useWebSocket } from '@/lib/hooks/useWebSocket'

function ColorblindModeProbe() {
  const { colorblindMode, setColorblindMode } = useUiPreferences()

  return (
    <button type="button" onClick={() => setColorblindMode(!colorblindMode)}>
      Colorblind mode {colorblindMode ? 'on' : 'off'}
    </button>
  )
}

describe('SettingsModal section navigation', () => {
  test('lets mobile users select a section and displays its content', () => {
    render(<SettingsModal isOpen onClose={() => {}} />)

    const sectionSelect = screen.getByRole('combobox', { name: 'Settings section' })
    expect(sectionSelect).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()

    fireEvent.change(sectionSelect, { target: { value: 'appearance' } })

    expect(sectionSelect).toHaveValue('appearance')
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText(/Choose the shell theme for this browser/i)).toBeInTheDocument()
  })

  test('shows the actual source and resolved FX rate for each year', () => {
    render(<SettingsModal isOpen onClose={() => {}} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings section' }), { target: { value: 'appearance' } })

    const builtIn = screen.getByRole('spinbutton', { name: /2024/ })
    const admin = screen.getByRole('spinbutton', { name: /2025/ })
    const local = screen.getByRole('spinbutton', { name: /2026/ })
    expect(builtIn).toHaveAttribute('placeholder', '25000')
    expect(builtIn.closest('label')).toHaveTextContent('Using built-in yearly default')
    expect(admin).toHaveAttribute('placeholder', '30000')
    expect(admin.closest('label')).toHaveTextContent('Using admin yearly default')
    expect(local).toHaveValue(32_000)
    expect(local.closest('label')).toHaveTextContent('Local override')
  })
})

describe('UiPreferencesProvider — colorblind mode (BUG-01)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-color-mode')
  })

  test('loads the saved colorblind preference and applies the DOM attribute', async () => {
    localStorage.setItem('vnibb-colorblind-mode', 'true')

    render(
      <UiPreferencesProvider>
        <ColorblindModeProbe />
      </UiPreferencesProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Colorblind mode on' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-color-mode', 'colorblind')
  })

  test('persists colorblind preference changes and updates the DOM attribute', async () => {
    render(
      <UiPreferencesProvider>
        <ColorblindModeProbe />
      </UiPreferencesProvider>,
    )
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-color-mode', 'default'))
    fireEvent.click(screen.getByRole('button', { name: 'Colorblind mode off' }))

    expect(await screen.findByRole('button', { name: 'Colorblind mode on' })).toBeInTheDocument()
    expect(localStorage.getItem('vnibb-colorblind-mode')).toBe('true')
    expect(document.documentElement).toHaveAttribute('data-color-mode', 'colorblind')
  })
})

describe('SettingsModal desktop alerts', () => {
  test('offers an explicit browser-local opt-in and saves the off switch independently of browser permission', async () => {
    window.localStorage.clear()
    const requestPermission = jest.fn()
    const original = Object.getOwnPropertyDescriptor(window, 'Notification')
    const notification = Object.assign(jest.fn(), { permission: 'granted', requestPermission })
    Object.defineProperty(window, 'Notification', { configurable: true, value: notification })
    const openNotifications = () => fireEvent.change(screen.getByRole('combobox', { name: 'Settings section' }), { target: { value: 'notifications' } })

    try {
      const first = render(<SettingsModal isOpen onClose={() => {}} />)
      openNotifications()
      fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }))
      expect(await screen.findByRole('button', { name: 'Turn off desktop alerts' })).toBeEnabled()
      first.unmount()

      const second = render(<SettingsModal isOpen onClose={() => {}} />)
      openNotifications()
      fireEvent.click(screen.getByRole('button', { name: 'Turn off desktop alerts' }))
      expect(screen.getByRole('button', { name: 'Enable desktop alerts' })).toBeEnabled()
      second.unmount()

      render(<SettingsModal isOpen onClose={() => {}} />)
      openNotifications()
      expect(screen.queryByRole('button', { name: 'Turn off desktop alerts' })).not.toBeInTheDocument()
      expect(requestPermission).not.toHaveBeenCalled()
      expect(notification).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(window, 'Notification', original)
      else Reflect.deleteProperty(window, 'Notification')
      window.localStorage.clear()
    }
  })
})

test('turning desktop alerts off in workspace Settings silences all three senders without losing new unread activity', async () => {
  window.localStorage.clear()
  const original = Object.getOwnPropertyDescriptor(window, 'Notification')
  const notification = Object.assign(jest.fn(), { permission: 'granted', requestPermission: jest.fn() })
  Object.defineProperty(window, 'Notification', { configurable: true, value: notification })
  const insider = jest.mocked(getInsiderAlerts)
  const screener = jest.mocked(getScreenerData)
  const socket = jest.mocked(useWebSocket)
  insider.mockResolvedValue([])
  const setScan = (...symbols: readonly string[]) => screener.mockResolvedValue({
    data: symbols.map((ticker) => ({ ticker })), meta: { availability: 'available' },
  })
  setScan('VCI')
  socket.mockReturnValue({ isConnected: true, isReceiving: true, protocolError: null, prices: new Map(), lastUpdate: null, marketStatus: null, reconnect: jest.fn() })
  const rules = { alerts: ['FPT', 'VNM'].map((symbol) => ({
    id: symbol, symbol, condition: 'above', threshold: 100, isActive: true, createdAt: '2026-11-17T00:00:00Z', notificationSent: false,
  })) }
  const quality = {
    id: 'quality', name: 'Quality', quickFilters: [{ id: 'roe', value: { gte: 15 }, displayValue: 'ROE >= 15%' }],
    advancedFilters: null, columns: ['ticker'], sortField: 'roe', sortOrder: 'desc', market: 'HOSE', alertEnabled: true, alertMatchSymbols: ['VCI'],
  }
  const scan = { ...quality, activeScreenId: quality.id, savedScreens: [quality] }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const dashboard = {
    state: { dashboards: [{ tabs: [{ widgets: [{ type: 'watchlist', config: { watchlistSymbols: ['VCI'] } }] }] }] },
  } as ContextType<typeof DashboardContext>

  function Workspace() {
    const [isOpen, setOpen] = useState(false)
    return <QueryClientProvider client={client}>
      <DashboardContext.Provider value={dashboard}>
        <button type="button" onClick={() => setOpen(true)}>Workspace settings</button>
        <SettingsModal isOpen={isOpen} onClose={() => setOpen(false)} />
        <AlertNotificationPanel />
        <PriceAlertsWidget id="price" config={rules} />
        <ScreenerWidget id="screener" config={scan} />
      </DashboardContext.Provider>
    </QueryClientProvider>
  }

  function openNotifications() {
    fireEvent.click(screen.getByRole('button', { name: 'Workspace settings' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings section' }), { target: { value: 'notifications' } })
  }

  async function publish(id: number, title: string, priceSymbol: string, ...matches: readonly string[]) {
    insider.mockResolvedValue([{ id, alert_type: 'INSIDER_BUY', severity: 'low', symbol: 'VCI', title,
      description: 'Synthetic insider fixture', timestamp: new Date().toISOString(), read: false, read_at: null }])
    setScan('VCI', ...matches)
    const onUpdate = socket.mock.lastCall?.[0].onUpdate
    expect(onUpdate).toBeDefined()
    await act(async () => {
      onUpdate?.({ symbol: priceSymbol, price: 105 })
      await Promise.all([client.refetchQueries({ queryKey: ['insider-alerts'] }), client.refetchQueries({ queryKey: ['screener'] })])
    })
  }

  const view = render(<Workspace />)
  try {
    await waitFor(() => {
      expect(client.getQueryState(['insider-alerts', 1, true])?.status).toBe('success')
      expect(client.getQueriesData({ queryKey: ['screener'], predicate: (query) => query.state.status === 'success' })).toHaveLength(1)
    })
    openNotifications()
    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }))
    await screen.findByRole('button', { name: 'Turn off desktop alerts' })
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    await publish(101, 'Insider before off', 'FPT', 'FPT')
    await screen.findByRole('button', { name: 'Alert activity, 3 unread' })
    const delivered = ['FPT price alert triggered', 'Insider before off', 'Quality: 1 new match'].sort()
    expect(notification.mock.calls.map(([title]) => title).sort()).toEqual(delivered)

    openNotifications()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off desktop alerts' }))
    expect(screen.getByRole('button', { name: 'Enable desktop alerts' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    await publish(102, 'Insider after off', 'VNM', 'FPT', 'HPG')
    fireEvent.click(await screen.findByRole('button', { name: 'Alert activity, 6 unread' }))
    const inbox = within(screen.getByRole('dialog', { name: 'Alerts' }))
    fireEvent.change(inbox.getByRole('combobox', { name: 'Alert scope' }), { target: { value: 'all' } })
    expect(inbox.getByRole('button', { name: /Insider after off/ })).toBeVisible()
    expect(inbox.getByRole('button', { name: /VNM price alert triggered/ })).toBeVisible()
    expect(inbox.getAllByRole('button', { name: /Quality: 1 new match/ })).toHaveLength(2)
    expect(inbox.getAllByText('Unread', { exact: true })).toHaveLength(6)
    expect(notification.mock.calls.map(([title]) => title).sort()).toEqual(delivered)
    expect(notification.requestPermission).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    client.clear()
    if (original) Object.defineProperty(window, 'Notification', original)
    else Reflect.deleteProperty(window, 'Notification')
    window.localStorage.clear()
  }
})

describe('SettingsModal default ticker contract', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  test('shows the saved default ticker instead of the active global symbol', () => {
    localStorage.setItem('vnibb-user-preferences', JSON.stringify({ defaultTicker: 'HPG' }))
    const { useSymbolLink } = jest.requireMock('@/contexts/SymbolLinkContext') as {
      useSymbolLink: () => { setGlobalSymbol: jest.Mock }
    }
    const setGlobalSymbol = useSymbolLink().setGlobalSymbol
    setGlobalSymbol.mockClear()

    render(<SettingsModal isOpen onClose={() => {}} />)

    const input = screen.getByLabelText('Default Ticker')
    expect(input).toHaveValue('HPG')

    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))

    expect(JSON.parse(localStorage.getItem('vnibb-user-preferences') || '{}').defaultTicker).toBe('HPG')
    expect(setGlobalSymbol).toHaveBeenCalledWith('HPG')
    expect(input).toHaveValue('HPG')
  })
})

