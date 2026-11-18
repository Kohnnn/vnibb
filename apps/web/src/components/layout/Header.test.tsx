import { fireEvent, render, screen } from '@testing-library/react'
import { Header } from './Header'
import { useAuth } from '@/contexts/AuthContext'

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }))
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', setTheme: jest.fn(), resolvedTheme: 'dark' }) }))
jest.mock('@/lib/env', () => ({ env: { authBypassEnabled: true } }))
jest.mock('@/lib/queries', () => ({
  useStockQuote: () => ({ data: null }),
  useMarketOverview: () => ({ data: { data: [] }, isLoading: false }),
  useHistoricalPrices: () => ({ data: { data: [], meta: {} } }),
}))
jest.mock('../widgets/AlertNotificationPanel', () => ({ AlertNotificationPanel: () => <button>Alert activity</button> }))

const mockUseAuth = jest.mocked(useAuth)
const signedInUser = { id: 'user-1', email: 'person@example.com', user_metadata: {}, provider: 'supabase' as const }

function setAuthUser(user: typeof signedInUser | null, signOut = jest.fn()) {
  mockUseAuth.mockReturnValue({ user, loading: false, provider: 'supabase', isAdmin: false, isGuest: false, signOut } as never)
  return signOut
}

describe('Header account menu with auth bypass enabled', () => {
  it('lets signed-in users sign out and keeps the trigger hidden for anonymous users', () => {
    const signOut = setAuthUser(signedInUser)
    const { rerender } = render(<Header currentSymbol="AAPL" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)

    setAuthUser(null)
    rerender(<Header currentSymbol="AAPL" />)
    expect(screen.queryByRole('button', { name: 'Open account menu' })).not.toBeInTheDocument()
  })

  it('keeps display and layout controls keyboard accessible in Dashboard options', () => {
    setAuthUser(null)
    const onAutoFitLayout = jest.fn()
    render(<Header currentSymbol="AAPL" onAutoFitLayout={onAutoFitLayout} />)

    const trigger = screen.getByRole('button', { name: 'Dashboard options' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const displaySettings = screen.getByRole('menuitem', { name: 'Display settings' })
    expect(displaySettings).toHaveFocus()
    fireEvent.keyDown(displaySettings, { key: 'ArrowRight' })
    expect(screen.getByRole('menuitem', { name: 'dark' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(displaySettings).toHaveFocus()
    fireEvent.keyDown(displaySettings, { key: 'ArrowDown' })
    const autoFit = screen.getByRole('menuitem', { name: 'Auto-fit layout' })
    expect(autoFit).toHaveFocus()
    fireEvent.keyDown(autoFit, { key: 'Enter' })
    expect(onAutoFitLayout).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveFocus()
  })
})
