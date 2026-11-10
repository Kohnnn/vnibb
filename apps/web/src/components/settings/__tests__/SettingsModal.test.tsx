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
  const value = { state: { dashboards: [], folders: [] }, activeDashboard: null, setActiveDashboard: jest.fn(), setActiveTab: jest.fn() }
  return { useDashboard: () => value }
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SettingsModal } from '../SettingsModal'
import { UiPreferencesProvider, useUiPreferences } from '@/contexts/UiPreferencesContext'

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

