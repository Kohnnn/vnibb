import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
jest.mock('@/lib/backendHealth', () => ({ probeBackendReadiness: jest.fn().mockResolvedValue({ healthOk: true, dataOk: true }) }))
jest.mock('../widgets/AlertNotificationPanel', () => ({ AlertNotificationPanel: () => <button>Alert activity</button> }))

const mockUseAuth = jest.mocked(useAuth)
const signedInUser = { id: 'user-1', email: 'person@example.com', user_metadata: {}, provider: 'supabase' as const }

function setAuthUser(user: typeof signedInUser | null, signOut = jest.fn()) {
  mockUseAuth.mockReturnValue({ user, loading: false, provider: 'supabase', isAdmin: false, isGuest: false, signOut } as never)
  return signOut
}

describe('Header account menu with auth bypass enabled', () => {
  it('lets signed-in users sign out and keeps the trigger hidden for anonymous users', async () => {
    const signOut = setAuthUser(signedInUser)
    const { rerender } = render(<Header currentSymbol="AAPL" />)
    await waitFor(() => expect(screen.getByLabelText(/Backend Healthy/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)

    setAuthUser(null)
    rerender(<Header currentSymbol="AAPL" />)
    expect(screen.queryByRole('button', { name: 'Open account menu' })).not.toBeInTheDocument()
  })

  it('allows header tools including alerts to wrap within the available mobile width', () => {
    setAuthUser(signedInUser)
    const { container } = render(<Header currentSymbol="AAPL" onAIClick={jest.fn()} onAutoFitLayout={jest.fn()} onEditToggle={jest.fn()} onResetLayout={jest.fn()} />)
    const tools = container.querySelector('[data-tour="header-tools"]')
    expect(tools).toHaveClass('min-w-0', 'max-w-full', 'flex-wrap')
    expect(tools).toContainElement(screen.getByRole('button', { name: 'Alert activity' }))
  })
})
