import { fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useState } from 'react'

import { CopilotArtifactPanel } from './CopilotArtifactPanel'
import type { CopilotTableArtifact } from '@/lib/api'
import { ARTIFACT_PLACEMENT_KEY, ARTIFACT_WIDGET_PROVENANCE_KEY } from '@/lib/copilotArtifactProvenance'
import { readNotebookItems, RESEARCH_NOTEBOOK_KEY } from '@/lib/researchNotebook'

const mockAddWidget = jest.fn(() => ({ id: 'created-widget' }))
const mockSetSymbol = jest.fn()
const mockSetDashboard = jest.fn()
const mockSetTab = jest.fn()
const mockFocus = jest.fn()
const mockUseDashboard = jest.fn()
const mockUseSymbolLink = jest.fn()
const mockState = {
  activeDashboardId: 'system',
  activeTabId: 'system-tab',
  dashboards: [
    { id: 'system', name: 'Published', isEditable: false, adminUnlocked: true, tabs: [{ id: 'system-tab', name: 'Overview', widgets: [] }] },
    { id: 'default-global-markets', name: 'Global Markets', isEditable: true, adminUnlocked: true, tabs: [{ id: 'global-tab', name: 'Global', widgets: [] }] },
    { id: 'personal', name: 'Research', isEditable: true, tabs: [{ id: 'notes', name: 'Notes', widgets: [] }, { id: 'valuation', name: 'Valuation', widgets: [] }] },
  ],
}

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => mockUseDashboard(),
}))
jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => mockUseSymbolLink(),
}))
jest.mock('@/lib/vniagentWorkspace', () => ({
  ...jest.requireActual('@/lib/vniagentWorkspace'),
  focusDashboardWidget: (...args: unknown[]) => mockFocus(...args),
}))
jest.mock('@/lib/api', () => ({ submitCopilotOutcome: jest.fn().mockResolvedValue(undefined) }))

const artifact: CopilotTableArtifact = {
  id: 'price_trend_chart',
  type: 'table',
  title: 'FPT price history',
  columns: [{ key: 'symbol', label: 'Ticker' }],
  rows: [{ symbol: 'FPT' }],
  widgetTarget: { widgetType: 'price_chart', label: 'Price Chart', symbol: 'FPT', config: { timeframe: '1y' } },
}

/** A second artifact of the same response, targeting a different widget type. */
const secondArtifact: CopilotTableArtifact = {
  id: 'foreign_flow_leaderboard',
  type: 'table',
  title: 'Foreign flow leaders',
  columns: [{ key: 'symbol', label: 'Ticker' }],
  rows: [{ symbol: 'VNM' }],
  widgetTarget: { widgetType: 'foreign_trading', label: 'Foreign Trading', symbol: 'VNM', config: {} },
}

const responseMeta = { responseId: 'resp:test-1', provider: 'vniagent', model: 'test-model', mode: 'analysis', latencyMs: 1200 }

describe('artifact placement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFocus.mockReset()
    window.localStorage.clear()
    mockAddWidget.mockImplementation(() => ({ id: 'created-widget' }))
    mockUseDashboard.mockImplementation(() => ({ state: mockState, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
    mockUseSymbolLink.mockImplementation(() => ({ globalSymbol: 'VNM', setGlobalSymbol: mockSetSymbol }))
  })

  it('places the artifact in the chosen personal tab without offering published layouts', () => {
    render(<CopilotArtifactPanel artifacts={[artifact]} />)
    const destination = screen.getByRole('combobox', { name: /destination/i })
    expect(Array.from((destination as HTMLSelectElement).options).map((option) => option.value)).toEqual(['notes', 'valuation'])
    expect(mockSetSymbol).not.toHaveBeenCalled()

    fireEvent.change(destination, { target: { value: 'valuation' } })
    fireEvent.click(screen.getByRole('button', { name: /add fpt price chart/i }))

    expect(mockAddWidget).toHaveBeenCalledWith('personal', 'valuation', expect.objectContaining({
      type: 'price_chart',
      tabId: 'valuation',
      config: expect.objectContaining({ timeframe: '1y', symbol: 'FPT' }),
      layout: expect.objectContaining({ x: 0, y: Infinity }),
    }))
    expect(mockSetSymbol).not.toHaveBeenCalled()
    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ dashboardId: 'personal', tabId: 'valuation', widgetId: 'created-widget' }), mockSetDashboard, mockSetTab)
  })

  it('does not change the shared ticker or navigate when adding fails', () => {
    mockAddWidget.mockImplementationOnce(() => { throw new Error('storage unavailable') })
    render(<CopilotArtifactPanel artifacts={[artifact]} />)

    fireEvent.click(screen.getByRole('button', { name: /add fpt price chart/i }))

    expect(mockSetSymbol).not.toHaveBeenCalled()
    expect(mockFocus).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it.each(['add', 'open'])('applies the %s artifact ticker only after destination scope becomes active', (action) => {
    const writes: Array<{ dashboardId: string; symbol: string }> = []
    const scopedDashboards = [
      { id: 'source', name: 'Source', isEditable: true, tabs: [{ id: 'source-tab', name: 'Source tab', widgets: [] }] },
      { id: 'target', name: 'Target', isEditable: true, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'existing', type: 'price_chart', config: { symbol: 'FPT' } }] }] },
    ]

    function ScopedWorkspace() {
      const [activeDashboardId, setActiveDashboardId] = useState('source')
      const [symbols, setSymbols] = useState<Record<string, string>>({ source: 'VNM', target: 'VCI' })
      const setSymbol = useCallback((symbol: string) => {
        writes.push({ dashboardId: activeDashboardId, symbol })
        setSymbols((current) => ({ ...current, [activeDashboardId]: symbol }))
      }, [activeDashboardId])
      mockUseDashboard.mockImplementation(() => ({
        state: { ...mockState, dashboards: scopedDashboards, activeDashboardId, activeTabId: `${activeDashboardId}-tab` },
        addWidget: mockAddWidget,
        setActiveDashboard: setActiveDashboardId,
        setActiveTab: mockSetTab,
      }))
      mockUseSymbolLink.mockImplementation(() => ({ globalSymbol: symbols[activeDashboardId], setGlobalSymbol: setSymbol }))
      return <>
        <button onClick={() => setActiveDashboardId('target')}>Complete navigation</button>
        <output data-testid="source-symbol">{symbols.source}</output>
        <output data-testid="target-symbol">{symbols.target}</output>
        <CopilotArtifactPanel artifacts={[artifact]} />
      </>
    }

    render(<ScopedWorkspace />)
    if (action === 'add') fireEvent.change(screen.getByRole('combobox', { name: /destination/i }), { target: { value: 'target-tab' } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${action} fpt price chart`, 'i') }))
    expect(writes).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Complete navigation' }))

    expect(screen.getByTestId('source-symbol')).toHaveTextContent('VNM')
    expect(screen.getByTestId('target-symbol')).toHaveTextContent('FPT')
    expect(writes).toEqual([{ dashboardId: 'target', symbol: 'FPT' }])
  })
})

describe('artifact destination memory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFocus.mockReset()
    window.localStorage.clear()
    mockUseDashboard.mockImplementation(() => ({ state: mockState, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
    mockUseSymbolLink.mockImplementation(() => ({ globalSymbol: 'VNM', setGlobalSymbol: mockSetSymbol }))
  })

  it('defaults the next artifact of the response to the dashboard and tab just chosen', () => {
    render(<CopilotArtifactPanel artifacts={[artifact, secondArtifact]} responseMeta={responseMeta} />)
    // Both cards open on the active tab until the user picks something.
    expect(screen.getAllByRole('combobox', { name: /destination/i }).map((select) => (select as HTMLSelectElement).value)).toEqual(['notes', 'notes'])

    fireEvent.change(screen.getAllByRole('combobox', { name: /destination/i })[0], { target: { value: 'valuation' } })

    expect((screen.getAllByRole('combobox', { name: /destination/i })[1] as HTMLSelectElement).value).toBe('valuation')
    expect(JSON.parse(window.localStorage.getItem(ARTIFACT_PLACEMENT_KEY) as string)).toEqual({
      dashboardId: 'personal',
      tabId: 'valuation',
      label: 'Research / Valuation',
    })

    fireEvent.click(screen.getAllByRole('button', { name: /add .*foreign trading/i })[0])
    expect(mockAddWidget).toHaveBeenLastCalledWith('personal', 'valuation', expect.objectContaining({ type: 'foreign_trading' }))
  })

  it('remembers the chosen destination across a reload', () => {
    window.localStorage.setItem(ARTIFACT_PLACEMENT_KEY, JSON.stringify({ dashboardId: 'personal', tabId: 'valuation', label: 'Research / Valuation' }))

    render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)

    expect((screen.getByRole('combobox', { name: /destination/i }) as HTMLSelectElement).value).toBe('valuation')
  })
})

describe('artifact provenance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFocus.mockReset()
    mockAddWidget.mockImplementation(() => ({ id: 'created-widget' }))
    window.localStorage.clear()
    mockUseDashboard.mockImplementation(() => ({ state: mockState, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
    mockUseSymbolLink.mockImplementation(() => ({ globalSymbol: 'VNM', setGlobalSymbol: mockSetSymbol }))
  })

  it('writes the artifact identity into the created widget config and shows where it landed', () => {
    render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)

    fireEvent.change(screen.getByRole('combobox', { name: /destination/i }), { target: { value: 'valuation' } })
    fireEvent.click(screen.getByRole('button', { name: /add fpt price chart/i }))

    const [, , widgetCreate] = mockAddWidget.mock.calls[0] as unknown as [string, string, { config: Record<string, unknown> }]
    const config = widgetCreate.config
    expect(config.copilotArtifactProvenance).toMatchObject({
      artifactId: 'price_trend_chart',
      responseId: 'resp:test-1',
      artifactType: 'table',
      dashboardId: 'personal',
      tabId: 'valuation',
      destination: 'Research / Valuation',
    })
    expect(screen.getByText('Added to Research / Valuation')).toBeInTheDocument()
  })

  it('restores the added-to state after a reload, without the widget list reloading first', () => {
    // Simulates a fresh document: only the durable stores survive.
    window.localStorage.setItem(ARTIFACT_WIDGET_PROVENANCE_KEY, JSON.stringify({
      'created-widget': {
        artifactId: 'price_trend_chart',
        responseId: 'resp:test-1',
        artifactType: 'table',
        artifactTitle: 'FPT price history',
        dashboardId: 'personal',
        tabId: 'valuation',
        destination: 'Research / Valuation',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }))
    window.localStorage.setItem(ARTIFACT_PLACEMENT_KEY, JSON.stringify({ dashboardId: 'personal', tabId: 'valuation', label: 'Research / Valuation' }))

    render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)

    expect(screen.getByText('Added to Research / Valuation')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add fpt price chart/i }) && screen.getByRole('status')).toBeInTheDocument()
  })

  it('does not claim a widget from another response as added', () => {
    window.localStorage.setItem(ARTIFACT_WIDGET_PROVENANCE_KEY, JSON.stringify({
      'created-widget': {
        artifactId: 'price_trend_chart',
        responseId: 'resp:someone-else',
        artifactType: 'table',
        artifactTitle: 'FPT price history',
        dashboardId: 'personal',
        tabId: 'valuation',
        destination: 'Research / Valuation',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }))

    render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)

    expect(screen.queryByText('Added to Research / Valuation')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add fpt price chart/i })).toBeInTheDocument()
  })
})

describe('artifact research notebook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFocus.mockReset()
    window.localStorage.clear()
    mockUseDashboard.mockImplementation(() => ({ state: mockState, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
    mockUseSymbolLink.mockImplementation(() => ({ globalSymbol: 'VNM', setGlobalSymbol: mockSetSymbol }))
  })

  it('saves a table artifact once and reports it as saved when clicked twice', () => {
    render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)

    const save = screen.getByRole('button', { name: /save table to research notebook/i })
    fireEvent.click(save)
    fireEvent.click(screen.getByRole('button', { name: /saved to research notebook/i }))

    const items = readNotebookItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'artifact',
      title: 'FPT price history',
      symbol: 'FPT',
      dedupeKey: 'vniagent-artifact:resp:test-1:price_trend_chart',
      artifact: { artifactId: 'price_trend_chart', responseId: 'resp:test-1', artifactType: 'table' },
    })
    expect(items[0].body).toContain('| Ticker |')
    expect(JSON.parse(window.localStorage.getItem(RESEARCH_NOTEBOOK_KEY) as string)).toHaveLength(1)
  })

  it('keeps the artifact in the notebook after a reload', () => {
    window.localStorage.setItem(RESEARCH_NOTEBOOK_KEY, JSON.stringify([{
      id: 'nb:1',
      kind: 'artifact',
      title: 'FPT price history',
      body: '| Ticker |\n| --- |\n| FPT |',
      dedupeKey: 'vniagent-artifact:resp:test-1:price_trend_chart',
      artifact: { artifactId: 'price_trend_chart', responseId: 'resp:test-1', artifactType: 'table' },
      createdAt: '2026-01-01T00:00:00.000Z',
    }]))

    render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)
    fireEvent.click(screen.getByRole('button', { name: /save table to research notebook/i }))

    expect(readNotebookItems()).toHaveLength(1)
    expect(readNotebookItems()[0].body).toContain('FPT')
  })
})
