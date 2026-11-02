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
    render(<CopilotEvidencePanel sources={[{ id: 'source-1', label: 'VNIBB source', source: 'postgres' }]} />)

    const trigger = screen.getByRole('button', { name: /sources/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-controls')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(trigger.getAttribute('aria-controls') || '')).toBeInTheDocument()
  })

  test('a URL alone does not claim a checked source reference', () => {
    render(
      <CopilotEvidencePanel
        sources={[{ id: 'source-2', label: 'Issuer filing', source: 'postgres', url: 'https://example.com/filing.pdf' }]}
      />,
    )
    expect(screen.queryByText('Source reference checked')).not.toBeInTheDocument()
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('1 listed')).toBeInTheDocument()
  })

  test('renders a server check result when one exists', () => {
    render(
      <CopilotEvidencePanel
        sources={[
          { id: 'source-1', label: 'VNIBB source', source: 'postgres', referenceChecked: true },
          { id: 'source-2', label: 'Browser context', source: 'browser_context' },
        ]}
      />,
    )
    expect(screen.getByText('Source reference checked')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 checked')).toBeInTheDocument()
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })
})
