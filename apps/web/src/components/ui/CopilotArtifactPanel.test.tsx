import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { CopilotArtifactPanel } from './CopilotArtifactPanel'
import type { CopilotTableArtifact } from '@/lib/api'
import type { WidgetCreate } from '@/types/dashboard'
import { ARTIFACT_PLACEMENT_KEY, ARTIFACT_WIDGET_PROVENANCE_KEY } from '@/lib/copilotArtifactProvenance'
import { readNotebookItems, RESEARCH_NOTEBOOK_KEY } from '@/lib/researchNotebook'
import { readTickerScope, resolveWidgetSymbol } from '@/lib/widgetScope'

const mockAddWidget = jest.fn((_dashboardId: string, _tabId: string, _input: WidgetCreate) => ({ id: 'created-widget' }))
const mockSetDashboard = jest.fn()
const mockSetTab = jest.fn()
const mockFocus = jest.fn((_target: unknown, _navigate: (id: string) => void, _setTab: unknown) => {})
const mockUseDashboard = jest.fn()
const mockState = {
  activeDashboardId: 'system',
  activeTabId: 'system-tab',
  dashboards: [
    { id: 'system', name: 'Published', isEditable: false, adminUnlocked: true, tabs: [{ id: 'system-tab', name: 'Overview', widgets: [] }] },
    { id: 'default-global-markets', name: 'Global Markets', isEditable: true, adminUnlocked: true, tabs: [{ id: 'global-tab', name: 'Global', widgets: [] }] },
    { id: 'personal', name: 'Research', isEditable: true, tabs: [{ id: 'notes', name: 'Notes', widgets: [] }, { id: 'valuation', name: 'Valuation', widgets: [] }] },
  ],
}
const mockGetSharedGroups = jest.fn(() => ({ global: { symbol: 'VCI' }, A: { symbol: 'FPT' } }))
const mockTickerOverrideFor = jest.fn((_id: string): string | null => null)

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => mockUseDashboard(),
}))
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ getSharedGroups: mockGetSharedGroups, tickerOverrideFor: mockTickerOverrideFor }),
}))
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({
  useGlobalMarketsSymbol: () => ({ appGlobalMarketsSymbol: 'VCI' }),
}))
jest.mock('@/lib/vniagentWorkspace', () => ({
  ...jest.requireActual('@/lib/vniagentWorkspace'),
  focusDashboardWidget: (target: unknown, navigate: (id: string) => void, setTab: unknown) => mockFocus(target, navigate, setTab),
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
    mockTickerOverrideFor.mockImplementation(() => null)
    window.localStorage.clear()
    mockAddWidget.mockImplementation(() => ({ id: 'created-widget' }))
    mockUseDashboard.mockImplementation(() => ({ state: mockState, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
  })

  it('places the artifact in the chosen personal tab without offering published layouts', () => {
    render(<CopilotArtifactPanel artifacts={[artifact]} />)
    const destination = screen.getByRole('combobox', { name: /destination/i })
    expect(Array.from((destination as HTMLSelectElement).options).map((option) => option.value)).toEqual(['notes', 'valuation'])

    fireEvent.change(destination, { target: { value: 'valuation' } })
    fireEvent.click(screen.getByRole('button', { name: /add fpt price chart/i }))

    expect(mockAddWidget).toHaveBeenCalledWith('personal', 'valuation', expect.objectContaining({
      type: 'price_chart',
      tabId: 'valuation',
      config: expect.objectContaining({ timeframe: '1y', symbol: 'FPT' }),
      layout: expect.objectContaining({ x: 0, y: Infinity }),
    }))
    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ dashboardId: 'personal', tabId: 'valuation', widgetId: 'created-widget' }), mockSetDashboard, mockSetTab)
  })

  it('does not change the shared ticker or navigate when adding fails', () => {
    mockAddWidget.mockImplementationOnce(() => { throw new Error('storage unavailable') })
    render(<CopilotArtifactPanel artifacts={[artifact]} />)

    fireEvent.click(screen.getByRole('button', { name: /add fpt price chart/i }))

    expect(mockFocus).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('keeps the promoted ticker local to its widget after navigation unmounts the source panel', () => {
    let placedConfig: Record<string, unknown> | undefined
    mockAddWidget.mockImplementation((_dashboardId, _tabId, input) => {
      placedConfig = input.config
      return { id: 'created-widget' }
    })
    mockFocus.mockImplementation((_target, navigate) => navigate('target'))
    function Workspace() {
      const [activeDashboardId, setActiveDashboardId] = useState('source')
      mockUseDashboard.mockImplementation(() => ({
        state: { ...mockState, dashboards: [
          { id: 'source', name: 'Source', isEditable: true, tabs: [{ id: 'source-tab', name: 'Source tab', widgets: [] }] },
          { id: 'target', name: 'Target', isEditable: true, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [] }] },
        ], activeDashboardId, activeTabId: `${activeDashboardId}-tab` },
        addWidget: mockAddWidget,
        setActiveDashboard: setActiveDashboardId,
        setActiveTab: mockSetTab,
      }))
      return activeDashboardId === 'source'
        ? <CopilotArtifactPanel artifacts={[artifact]} />
        : <output data-testid="destination-ticker">{resolveWidgetSymbol(readTickerScope(placedConfig), 'VCI')}</output>
    }

    render(<Workspace />)
    fireEvent.change(screen.getByRole('combobox', { name: /destination/i }), { target: { value: 'target-tab' } })
    fireEvent.click(screen.getByRole('button', { name: /add fpt price chart/i }))

    expect(screen.queryByRole('button', { name: /add fpt price chart/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('destination-ticker')).toHaveTextContent('FPT')
  })

  it('opens an existing widget without mutating its dashboard ticker', () => {
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      ...mockState.dashboards,
      { id: 'target', name: 'Target', isEditable: true, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'existing', type: 'price_chart', config: { tickerScope: 'override', symbol: 'FPT' } }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
    render(<CopilotArtifactPanel artifacts={[artifact]} />)

    fireEvent.click(screen.getByRole('button', { name: /open price chart/i }))

    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ dashboardId: 'target', widgetId: 'existing' }), mockSetDashboard, mockSetTab)
  })
  it('does not offer Open for a VCI-linked chart when the artifact is FPT', () => {
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      ...mockState.dashboards,
      { id: 'target', name: 'Target', isEditable: true, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'vci-chart', type: 'price_chart', config: { symbol: 'FPT' } }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))

    render(<CopilotArtifactPanel artifacts={[artifact]} />)

    expect(screen.queryByRole('button', { name: /open price chart/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add fpt price chart/i })).toBeInTheDocument()
  })

  it('opens a same-symbol group chart instead of a closer wrong-symbol chart', () => {
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      { ...mockState.dashboards[0], tabs: [{ id: 'system-tab', name: 'Overview', widgets: [{ id: 'wrong-chart', type: 'price_chart', config: {} }] }] },
      ...mockState.dashboards.slice(1),
      { id: 'target', name: 'Target', isEditable: true, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'fpt-chart', type: 'price_chart', widgetGroup: 'A', config: {} }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))

    render(<CopilotArtifactPanel artifacts={[artifact]} />)
    fireEvent.click(screen.getByRole('button', { name: /open price chart/i }))

    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ dashboardId: 'target', widgetId: 'fpt-chart' }), mockSetDashboard, mockSetTab)
    expect(mockAddWidget).not.toHaveBeenCalled()
  })
  it('opens an in-memory widget override without changing the shared ticker', () => {
    mockTickerOverrideFor.mockImplementation((id) => id === 'local-chart' ? 'FPT' : null)
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      ...mockState.dashboards,
      { id: 'target', name: 'Target', isEditable: true, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'local-chart', type: 'price_chart', config: {} }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))

    render(<CopilotArtifactPanel artifacts={[artifact]} />)
    fireEvent.click(screen.getByRole('button', { name: /open price chart/i }))

    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'local-chart' }), mockSetDashboard, mockSetTab)
  })

  it('matches destination workspace group ticker, not the current workspace group ticker', () => {
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      ...mockState.dashboards,
      { id: 'target', name: 'Target', isEditable: true, widgetGroups: { global: { symbol: 'FPT' } }, tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'target-chart', type: 'price_chart', config: {} }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))

    render(<CopilotArtifactPanel artifacts={[artifact]} />)
    fireEvent.click(screen.getByRole('button', { name: /open price chart/i }))

    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'target-chart' }), mockSetDashboard, mockSetTab)
  })
  it('does not open a linked TradingView chart whose effective Global Markets ticker differs', () => {
    const tradingViewArtifact: CopilotTableArtifact = {
      ...artifact, widgetTarget: { widgetType: 'tradingview_chart', label: 'Advanced Chart', symbol: 'FPT' },
    }
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      ...mockState.dashboards,
      { id: 'target', name: 'Target', isEditable: true, globalMarketsSymbol: 'VCI', tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'linked-chart', type: 'tradingview_chart', config: { symbol: 'FPT', useLinkedSymbol: true } }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))

    render(<CopilotArtifactPanel artifacts={[tradingViewArtifact]} />)

    expect(screen.queryByRole('button', { name: /open advanced chart/i })).not.toBeInTheDocument()
  })

  it('opens an unlinked TradingView chart at its own ticker', () => {
    const tradingViewArtifact: CopilotTableArtifact = {
      ...artifact, widgetTarget: { widgetType: 'tradingview_chart', label: 'Advanced Chart', symbol: 'FPT' },
    }
    mockUseDashboard.mockImplementation(() => ({ state: { ...mockState, dashboards: [
      ...mockState.dashboards,
      { id: 'target', name: 'Target', isEditable: true, globalMarketsSymbol: 'VCI', tabs: [{ id: 'target-tab', name: 'Target tab', widgets: [{ id: 'unlinked-chart', type: 'tradingview_chart', config: { symbol: 'FPT', useLinkedSymbol: false } }] }] },
    ] }, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))

    render(<CopilotArtifactPanel artifacts={[tradingViewArtifact]} />)
    fireEvent.click(screen.getByRole('button', { name: /open advanced chart/i }))

    expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'unlinked-chart' }), mockSetDashboard, mockSetTab)
  })
})

describe('artifact destination memory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFocus.mockReset()
    mockTickerOverrideFor.mockImplementation(() => null)
    window.localStorage.clear()
    mockUseDashboard.mockImplementation(() => ({ state: mockState, addWidget: mockAddWidget, setActiveDashboard: mockSetDashboard, setActiveTab: mockSetTab }))
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

  it('does not claim a save when notebook storage denies writes', () => {
    const denied = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied') })
    try {
      render(<CopilotArtifactPanel artifacts={[artifact]} responseMeta={responseMeta} />)
      fireEvent.click(screen.getByRole('button', { name: /save table to research notebook/i }))

      expect(screen.getByRole('button', { name: /save table to research notebook/i })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Could not save table to research notebook')
      expect(readNotebookItems()).toEqual([])
    } finally {
      denied.mockRestore()
    }
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
