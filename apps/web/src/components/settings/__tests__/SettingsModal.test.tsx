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
  const value = { config: { display: 'auto', decimalPlaces: 2 }, globalUsdVndDefaultRate: 25000, adminUsdVndRatesByYear: {}, localUsdVndRatesByYear: {}, setUnit: jest.fn(), setDecimalPlaces: jest.fn(), setUsdVndRate: jest.fn(), clearUsdVndRates: jest.fn(), applyAdminUsdRuntimeConfig: jest.fn() }
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

