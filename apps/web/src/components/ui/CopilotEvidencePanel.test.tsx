import { fireEvent, render, screen } from '@testing-library/react'

import { CopilotEvidencePanel } from './CopilotEvidencePanel'

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ state: {}, activeDashboard: null, activeTab: null }),
}))
jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({ globalSymbol: 'VNM', setGlobalSymbol: jest.fn() }),
}))
jest.mock('@/lib/dashboardLayout', () => ({ getWidgetDefaultLayout: jest.fn() }))
jest.mock('@/lib/vniagentWorkspace', () => ({
  findMatchingWidgetTarget: jest.fn(),
  focusDashboardWidget: jest.fn(),
  getIntentFromSource: jest.fn(),
}))
jest.mock('@/lib/api', () => ({ submitCopilotOutcome: jest.fn() }))

describe('CopilotEvidencePanel', () => {
  test('connects the evidence disclosure control to its panel', () => {
    render(<CopilotEvidencePanel sources={[{ id: 'source-1', label: 'VNIBB source', source: 'appwrite' }]} />)

    const trigger = screen.getByRole('button', { name: /evidence/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-controls')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(trigger.getAttribute('aria-controls') || '')).toBeInTheDocument()
  })
})
