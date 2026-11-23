import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './DashboardClient';
import { consumeCopilotStream, openCopilotChatStream, type FreshnessResponse } from '@/lib/api';
import type { ResearchStarter, StarterPromptKey } from '@/lib/researchStarters';
import type { Dashboard, DashboardTab } from '@/types/dashboard';
import type { DashboardContextValue } from '@/contexts/DashboardContext/types';
import { WidgetWrapper as LiveWidgetWrapper, type WidgetWrapperProps } from '@/components/widgets/WidgetWrapper';

let mockWalkthroughEligible = false;
let mockActiveDashboard: Dashboard | null = null;
let mockActiveTab: DashboardTab | null = null;
let mockDashboards: Dashboard[] = [];
let mockCatalogueReady = true;
let mockFreshness: FreshnessResponse | undefined;
let mockReferenceSymbol = 'HPG';
const LOCAL_SYNC = { enabled: false, status: 'idle', loadPaused: false } as const;
let mockBackendSync: DashboardContextValue['backendSync'] = LOCAL_SYNC;
const mockSetActiveDashboard = jest.fn();
const mockSetActiveTab = jest.fn();
const mockCreateDashboard = jest.fn((input: { name: string }) => ({
  id: `created-${input.name}`, name: input.name, order: 0, isDefault: false,
  isEditable: true, showGroupLabels: false, tabs: [], syncGroups: [],
  createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z',
}));
const mockCreateTab = jest.fn((dashboardId: string, name: string) => ({ id: `${dashboardId}-${name}`, name, order: 0, widgets: [] }));
const mockAddWidget = jest.fn();
const mockUpdateSyncGroupSymbol = jest.fn();

jest.mock('next/dynamic', () => {
  const React = jest.requireActual('react');
  return (load: () => Promise<{ default: ComponentType }>) => {
    const Component = React.lazy(load);
    return function DynamicComponent(props: Record<string, unknown>) {
      return <React.Suspense fallback={null}><Component {...props} /></React.Suspense>;
    };
  };
});

jest.mock('@/components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({
    state: { dashboards: mockDashboards },
    localStateReady: true,
    dashboardCatalogueReady: mockCatalogueReady,
    activeDashboard: mockActiveDashboard,
    activeTab: mockActiveTab,
    setActiveDashboard: mockSetActiveDashboard,
    setActiveTab: mockSetActiveTab,
    createDashboard: mockCreateDashboard,
    createTab: mockCreateTab,
    addWidget: mockAddWidget,
    updateSyncGroupSymbol: mockUpdateSyncGroupSymbol,
    backendSync: mockBackendSync,
  }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, isAdmin: false }) }));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({
    setGlobalSymbol: jest.fn(), groups: {}, getColorForGroup: () => 'transparent',
    getSymbolForGroup: () => mockReferenceSymbol, tickerOverrideFor: () => null,
  }),
}));
jest.mock('@/contexts/SymbolLinkContext', () => ({ useSymbolLink: () => ({ globalSymbol: 'VNM', setGlobalSymbol: jest.fn() }) }));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({ globalMarketsSymbol: 'AMEX:SPY', setGlobalMarketsSymbol: jest.fn() }) }));
jest.mock('@/contexts/UnitContext', () => ({ useUnit: () => ({ config: { display: 'auto' }, setUnit: jest.fn() }) }));
jest.mock('@/hooks/useUrlSync', () => ({ useUrlSync: jest.fn() }));
jest.mock('@/hooks/useResizeNudge', () => ({ useResizeNudge: jest.fn() }));
jest.mock('@/hooks/usePeriodState', () => ({ usePeriodState: () => ({ period: 'FY', setPeriod: jest.fn() }) }));
jest.mock('@/lib/userPreferences', () => ({
  ...jest.requireActual('@/lib/userPreferences'),
  shouldShowDashboardWalkthrough: () => mockWalkthroughEligible,
  dispatchOnboardingMeaningfulAction: jest.fn(),
}));
jest.mock('@/lib/backendHealth', () => ({ probeBackendReadiness: jest.fn().mockResolvedValue({ healthOk: true, dataOk: true }) }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
jest.mock('@/lib/queries', () => ({
  useOfficers: jest.requireActual('@/lib/queries/equity').useOfficers,
  useSubsidiaries: jest.requireActual('@/lib/queries/equity').useSubsidiaries,
  useProfile: () => ({ data: undefined }),
  useStockQuote: () => ({ data: undefined }),
  useFinancialRatios: () => ({ data: undefined }),
  useMarketFreshness: () => ({ data: mockFreshness, isLoading: false, isError: false }),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  openCopilotChatStream: jest.fn(),
  consumeCopilotStream: jest.fn(),
  getCopilotRuntimeConfig: jest.fn().mockResolvedValue({ provider: 'openrouter', model: 'test-model' }),
}));
jest.mock('@/components/layout', () => ({
  Sidebar: ({ onOpenTemplateSelector }: { onOpenTemplateSelector: () => void }) => <button onClick={onOpenTemplateSelector}>Open templates</button>,
  Header: ({ isAIOpen, onAIClick, globalStatus }: {
    isAIOpen: boolean;
    onAIClick: () => void;
    globalStatus?: ReactNode;
  }) => <header><button onClick={onAIClick}>{isAIOpen ? 'Close VniAgent' : 'Open VniAgent'}</button>{globalStatus}</header>,
  RightSidebar: ({ children, overlay }: { children: ReactNode; overlay: boolean }) => <aside aria-label={overlay ? 'Mobile copilot' : 'Desktop copilot'}>{children}</aside>,
  TabBar: () => null,
  MobileNav: () => null,
  DashboardHealth: jest.requireActual('@/components/layout/DashboardHealth').DashboardHealth,
  WhatsNewPanel: () => null,
}));
jest.mock('@/components/layout/DashboardGrid', () => ({
  ResponsiveDashboardGrid: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// Drive reference attachments through their real toolbar, publisher and query.
// Keep the shell stand-in for the unsupported-widget test.
jest.mock('@/components/widgets', () => ({
  WidgetWrapper: (props: WidgetWrapperProps) => {
    const { id, widgetType, children } = props;
    if (widgetType !== 'officers_management' && widgetType !== 'subsidiaries') {
      return <div data-testid={`widget-${id}`}>{children}</div>;
    }
    return <div data-testid={`widget-${id}`}><LiveWidgetWrapper {...props} /></div>;
  },
  WidgetLibrary: () => null,
  widgetRegistry: jest.requireActual('@/components/widgets/WidgetRegistry').widgetRegistry,
}));
jest.mock('@/components/modals', () => ({
  WidgetSettingsModal: () => null,
  AppsLibrary: () => null,
  TemplateSelector: ({ open, onStarterPromptRequest }: {
    open: boolean;
    onStarterPromptRequest: (prompt: StarterPromptKey, workflow: ResearchStarter['workflow']) => void;
  }) => open ? <button onClick={() => onStarterPromptRequest('analyze', { id: 'financial-summary', revision: 1 })}>Stage financial starter</button> : null,
}));
jest.mock('@/components/onboarding/OnboardingWalkthrough', () => ({
  // The route regression drives the real `onGoalSelect` the page passes down;
  // only the walkthrough's own presentation is stubbed. The returned boolean is
  // surfaced in the DOM so a fake success cannot hide: the walkthrough opens its
  // guide only on `true`, so `false` here must mean "not routed".
  OnboardingWalkthrough: ({ open, onGoalSelect, workspaceReady }: {
    open: boolean;
    onGoalSelect: (goalId: string, symbol?: string) => boolean;
    workspaceReady: boolean;
  }) => {
    const [routed, setRouted] = jest.requireActual<typeof import('react')>('react').useState<boolean | null>(null);
    return open ? (
      <section role="dialog" aria-label="Dashboard walkthrough" data-workspace-ready={workspaceReady}>
        <button onClick={() => setRouted(onGoalSelect('evaluate_company', 'HPG'))}>Open Financial review</button>
        <button onClick={() => setRouted(onGoalSelect('follow_ticker', 'HPG'))}>Open Ticker workspace</button>
        <span data-testid="route-result">{routed === null ? 'none' : String(routed)}</span>
      </section>
    ) : null;
  },
}));
jest.mock('@/components/modals/PromptsLibrary', () => ({ PromptsLibrary: () => null }));
jest.mock('@/components/ui/CopilotArtifactPanel', () => ({ CopilotArtifactPanel: () => null }));
jest.mock('@/components/ui/CopilotActionPanel', () => ({ CopilotActionPanel: () => null }));
jest.mock('@/components/ui/CopilotEvidencePanel', () => ({ CopilotEvidencePanel: () => null }));
jest.mock('@/components/ui/CopilotFeedbackBar', () => ({ CopilotFeedbackBar: () => null }));

function setViewport(width: number) {
  jest.replaceProperty(window, 'innerWidth', width);
  jest.replaceProperty(window, 'innerHeight', 900);
  jest.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
  });
}

describe('DashboardPage global freshness', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setViewport(1440);
  });

  afterEach(() => {
    mockFreshness = undefined;
    mockBackendSync = LOCAL_SYNC;
    jest.restoreAllMocks();
  });

  function report(status: 'fresh' | 'critical'): FreshnessResponse {
    return {
      timestamp: '2026-11-17T00:00:00Z',
      overall: status,
      buckets: [{ label: 'Prices', status, last_data_date: status === 'fresh' ? '2026-11-17' : '2026-11-10', age_days: status === 'fresh' ? 0 : 7, detail: null }],
    };
  }

  it('uses the existing header instead of a dedicated row for routine freshness', async () => {
    mockFreshness = report('fresh');
    await act(async () => { render(<DashboardPage />); });

    expect(screen.getByRole('banner')).toContainElement(
      screen.getByText(/all tracked data sources report fresh data/i),
    );
    expect(screen.queryByRole('region', { name: 'Workspace health details' })).not.toBeInTheDocument();
  });

  it('returns a dismissed warning to the header without leaving a dedicated row', async () => {
    mockFreshness = report('critical');
    await act(async () => { render(<DashboardPage />); });

    fireEvent.click(screen.getByRole('button', { name: 'Workspace health: Degraded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss freshness warning for this session' }));

    expect(screen.getByRole('banner')).toContainElement(
      screen.getByText(/freshness warning dismissed for this session/i),
    );
    expect(screen.queryByRole('region', { name: 'Workspace health details' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Workspace health: Dismissed' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.setup().keyboard('{Enter}');
    const details = screen.getByRole('region', { name: 'Workspace health details' });
    expect(details).toHaveFocus();
    expect(within(details).getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');
  });

  it('shows local persistence only inside workspace health in local mode', async () => {
    mockFreshness = report('fresh');
    mockBackendSync = { enabled: true, status: 'local', loadPaused: false };
    await act(async () => { render(<DashboardPage />); });

    expect(screen.queryByText('Saved on this device')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Workspace health: Fresh' }));
    const details = screen.getByRole('region', { name: 'Workspace health details' });
    expect(within(details).getByText('Saved on this device')).toBeInTheDocument();
  });
});

describe('DashboardPage unsupported saved widget', () => {
  afterEach(() => {
    mockActiveDashboard = null;
    mockActiveTab = null;
    jest.restoreAllMocks();
  });

  it('renders the retained saved tile instead of dropping an unresolvable widget', async () => {
    setViewport(1440);
    // Not in widgetDefinitions, not registered: the state a retired or
    // ahead-of-build widget ID leaves in a saved workspace.
    const widget = {
      id: 'retired-widget', type: 'retired_widget', tabId: 'saved-tab',
      config: { symbol: 'FPT', savedFlag: true },
      layout: { i: 'retired-widget', x: 0, y: 0, w: 8, h: 6 },
    } as unknown as DashboardTab['widgets'][number];
    mockActiveTab = { id: 'saved-tab', name: 'Saved', order: 0, widgets: [widget] };
    mockActiveDashboard = {
      id: 'saved-dashboard', name: 'Saved workspace', order: 0, isDefault: false,
      isEditable: true, showGroupLabels: true, tabs: [mockActiveTab!], syncGroups: [],
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };

    render(<DashboardPage />);

    const tile = await screen.findByTestId('widget-retired-widget');
    expect(tile).toHaveTextContent('retired widget is not available in this build');
    expect(tile).toHaveTextContent('Saved layout kept. Widget ID: retired_widget');
    expect(tile.closest('[data-widget-type]')).toHaveAttribute('data-widget-type', 'retired_widget');
  });
});

describe('DashboardPage initial walkthrough hydration', () => {
  afterEach(() => {
    mockWalkthroughEligible = false;
    mockActiveDashboard = null;
    mockActiveTab = null;
    jest.useRealTimers();
  });

  it('opens the first-visit walkthrough when hydration replaces the active view before its timer fires', async () => {
    jest.useFakeTimers();
    setViewport(1440);
    mockWalkthroughEligible = true;
    mockActiveTab = { id: 'hydrating-tab', name: 'Initial view', order: 0, widgets: [] };
    mockActiveDashboard = {
      id: 'hydrating-dashboard', name: 'Personal workspace', order: 0, isDefault: false,
      isEditable: true, showGroupLabels: true, tabs: [mockActiveTab], syncGroups: [],
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };
    const view = render(<DashboardPage />);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(screen.queryByRole('dialog', { name: 'Dashboard walkthrough' })).not.toBeInTheDocument();

    mockActiveTab = { ...mockActiveTab, name: 'Hydrated view' };
    mockActiveDashboard = { ...mockActiveDashboard, tabs: [mockActiveTab] };
    view.rerender(<DashboardPage />);
    await act(async () => { jest.advanceTimersByTime(300); });

    expect(await screen.findByRole('dialog', { name: 'Dashboard walkthrough' })).toBeInTheDocument();
  });
});

describe.each([
  { viewport: 'Desktop', width: 1440 },
  { viewport: 'Mobile', width: 390 },
])('DashboardPage $viewport copilot handoff', ({ width }) => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setViewport(width);
  });

  afterEach(() => jest.restoreAllMocks());

  it('opens the real composer with the Matrix selection without submitting', async () => {
    render(<DashboardPage />);
    expect(screen.queryByRole('textbox', { name: 'VniAgent message' })).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent('vnibb:matrix-followup', {
        detail: {
          selection: { snapshot_id: 'snap', result_ids: ['r'] },
          request_text: 'Explain the selected frozen result',
        },
      }));
    });

    await screen.findByTitle('Active model: test-model');
    expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('Explain the selected frozen result');
    expect(screen.getByText('Attached Matrix selection · 1 results')).toBeInTheDocument();
    expect(screen.getByText('Snapshot snap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Matrix selection' })).toBeInTheDocument();
    expect(openCopilotChatStream).not.toHaveBeenCalled();
    expect(consumeCopilotStream).not.toHaveBeenCalled();
  });

  it('stages each new template starter while the copilot stays mounted', async () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open templates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stage financial starter' }));

    await screen.findByTitle('Active model: test-model');
    const composer = screen.getByRole('textbox', { name: 'VniAgent message' });
    expect(composer).toHaveValue('Analyze the financial health of this company');
    fireEvent.change(composer, { target: { value: 'custom draft' } });
    expect(composer).toHaveValue('custom draft');

    fireEvent.click(screen.getByRole('button', { name: 'Stage financial starter' }));

    await waitFor(() => expect(composer).toHaveValue('Analyze the financial health of this company'));
    expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toBe(composer);
    expect(screen.getByRole('note', { name: 'Reviewed workflow requirements' })).toBeInTheDocument();
    expect(openCopilotChatStream).not.toHaveBeenCalled();
    expect(consumeCopilotStream).not.toHaveBeenCalled();
  });

  it('consumes a template starter so closing and reopening cannot replay it', async () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open templates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stage financial starter' }));

    await screen.findByTitle('Active model: test-model');
    expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('Analyze the financial health of this company');
    expect(screen.getByRole('note', { name: 'Reviewed workflow requirements' })).toBeInTheDocument();
    expect(openCopilotChatStream).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close VniAgent' }));
    expect(screen.queryByRole('textbox', { name: 'VniAgent message' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open VniAgent' }));

    await screen.findByTitle('Active model: test-model');
    expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('');
    expect(screen.queryByRole('note', { name: 'Reviewed workflow requirements' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Matrix selection' })).not.toBeInTheDocument();
    expect(openCopilotChatStream).not.toHaveBeenCalled();
    expect(consumeCopilotStream).not.toHaveBeenCalled();
  });
});

describe.each([
  { width: 1440, type: 'officers_management', route: 'officers', row: { symbol: 'HPG', name: 'Recovered officer' } },
  { width: 390, type: 'subsidiaries', route: 'subsidiaries', row: { symbol: 'HPG', company_name: 'Recovered subsidiary' } },
] as const)('DashboardPage $route live attachment', ({ width, type, route, row }) => {
  afterEach(() => {
    mockActiveDashboard = null;
    mockActiveTab = null;
    mockDashboards = [];
    mockReferenceSymbol = 'HPG';
    jest.restoreAllMocks();
  });

  it('sends the current reference observation and revokes it on leaving the mounted tile', async () => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setViewport(width);
    const tab = (id: string, name: string): DashboardTab => ({
      id, name, order: 0, widgets: [{ id: 'reference', tabId: id, type, config: {}, layout: { i: 'reference', x: 0, y: 0, w: 8, h: 6 } }],
    });
    const ownership = tab('ownership', 'Ownership');
    const other = tab('other-ownership', 'Other workspace view');
    mockActiveTab = ownership;
    mockActiveDashboard = {
      id: 'fixture', name: 'Company', order: 0, isDefault: false, isEditable: false, showGroupLabels: false,
      tabs: [ownership, other], syncGroups: [], createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z',
    };
    mockDashboards = [mockActiveDashboard];

    const fpt = Promise.withResolvers<unknown>();
    const hpg = jest.fn<Promise<unknown>, []>()
      .mockResolvedValueOnce({ data: [], error: 'Provider unavailable' })
      .mockResolvedValueOnce({ data: [row], meta: { count: 1, last_data_date: '2026-10-30' }, error: null });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const json = path.endsWith(`/HPG/${route}`) ? hpg
        : path.endsWith(`/FPT/${route}`) ? () => fpt.promise : undefined;
      if (!json) throw new Error(`Unexpected fetch: ${path}`);
      return { ok: true, status: 200, json } as Response;
    });
    jest.mocked(openCopilotChatStream).mockResolvedValue({ ok: true } as Response);
    jest.mocked(consumeCopilotStream).mockImplementation(async (_response, handlers) => {
      handlers?.onChunk?.('Fixture answer');
      handlers?.onDone?.({ done: true });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>;
    const view = render(tree());
    async function send(question: string) {
      await act(async () => {
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: question } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      });
      const request = jest.mocked(openCopilotChatStream).mock.lastCall?.[0];
      expect(request?.message).toBe(question);
      return request?.context;
    }
    try {
      await screen.findByText('Data unavailable for HPG');
      fireEvent.click(within(screen.getByTestId('widget-reference')).getByRole('button', { name: 'Open VniAgent' }));
      await screen.findByText('Connected Widget');
      expect(await send('What failed?')).toMatchObject({ symbol: 'HPG', widgetPayload: {
        dataSample: null, dataProvenance: { observationStatus: 'unavailable', warnings: ['Provider unavailable'] },
      } });

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('1 sampled rows attached')).toBeInTheDocument();
      expect(await send('What recovered?')).toMatchObject({ symbol: 'HPG', widgetPayload: {
        dashboardId: 'fixture', tabId: 'ownership', widgetId: 'reference', dataSample: [row],
        dataProvenance: { observationStatus: 'available', updatedAt: '2026-10-30' },
      } });

      mockReferenceSymbol = 'FPT';
      view.rerender(tree());
      expect(await send('What is loading?')).toMatchObject({ symbol: 'FPT', widgetPayload: {
        dataSample: null, dataProvenance: { observationStatus: 'loading' },
      } });
      await act(async () => fpt.resolve({ data: [], error: null }));
      await screen.findByText('No records returned for FPT');
      expect(await send('What was returned?')).toMatchObject({ symbol: 'FPT', widgetPayload: {
        dataSample: null, dataProvenance: { observationStatus: 'empty', coverage: 'unknown' },
      } });

      mockActiveTab = other; // This tab has a different tile with the same saved ID and type.
      view.rerender(tree());
      expect(screen.queryByText('Connected Widget')).not.toBeInTheDocument();
      const detached = await send('What is attached now?');
      expect(detached).toMatchObject({ widgetTypeKey: null });
      expect(detached?.widgetPayload).not.toHaveProperty('dataSample');
      expect(detached?.widgetPayload).not.toHaveProperty('dataProvenance');

      mockActiveTab = ownership;
      view.rerender(tree());
      expect(screen.queryByText('Connected Widget')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      client.clear();
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * #253 Evaluate-a-company routing.
 *
 * The live defect: `handleOnboardingGoalSelect` resolved the financial tab with
 * `tab.name === 'Financials'`, but the published Fundamental workspace names it
 * "Fundamentals", so "Open Financial review" returned false and the walkthrough
 * showed "This view is unavailable right now" without leaving Discovery.
 *
 * These drive the real handler through the real `useDashboard()` surface (not a
 * mocked walkthrough), with both retained layout shapes.
 */
describe('onboarding goal routing across published and bundled layouts', () => {
  const tab = (id: string, name: string): DashboardTab => ({ id, name, order: 0, widgets: [] });
  const fundamentalDashboard = (tabs: DashboardTab[]): Dashboard => ({
    id: 'default-fundamental',
    name: 'Fundamental',
    order: 0,
    isDefault: true,
    isEditable: false,
    showGroupLabels: false,
    tabs,
    syncGroups: [],
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
  });

  async function openWalkthroughWith(tabs: DashboardTab[], catalogueReady = true) {
    jest.useFakeTimers();
    setViewport(1440);
    mockWalkthroughEligible = true;
    mockCatalogueReady = catalogueReady;
    mockDashboards = [fundamentalDashboard(tabs)];
    mockActiveDashboard = mockDashboards[0];
    mockActiveTab = tabs[0];
    render(<DashboardPage />);
    await act(async () => { jest.advanceTimersByTime(300); });
    return screen.findByRole('dialog', { name: 'Dashboard walkthrough' });
  }

  afterEach(() => {
    mockWalkthroughEligible = false;
    mockCatalogueReady = true;
    mockDashboards = [];
    mockActiveDashboard = null;
    mockActiveTab = null;
    jest.clearAllMocks();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['published Fundamental layout', [
      tab('tab-default-fundamental-discovery', 'Discovery'),
      tab('tab-default-fundamental-fundamentals', 'Fundamentals'),
    ], 'tab-default-fundamental-fundamentals'],
    ['bundled fallback layout', [
      tab('default-fundamental-tab-0', 'Overview'),
      tab('default-fundamental-tab-1', 'Financials'),
    ], 'default-fundamental-tab-1'],
  ])('routes Open Financial review to the financial tab of the %s', async (_label, tabs, expectedTabId) => {
    await openWalkthroughWith(tabs);

    fireEvent.click(screen.getByRole('button', { name: 'Open Financial review' }));

    expect(mockSetActiveDashboard).toHaveBeenCalledWith('default-fundamental');
    expect(mockSetActiveTab).toHaveBeenCalledWith(expectedTabId);
    // The selected ticker survives the route instead of being dropped.
    expect(mockUpdateSyncGroupSymbol).toHaveBeenCalledWith('default-fundamental', 1, 'HPG');
  });

  it('reports a failed route honestly when the workspace has no financial tab', async () => {
    // Readiness settled, but this layout carries no financial surface: the
    // handler must return false rather than claim a route the user never got.
    await openWalkthroughWith([tab('tab-default-fundamental-discovery', 'Discovery')]);

    fireEvent.click(screen.getByRole('button', { name: 'Open Financial review' }));

    expect(screen.getByTestId('route-result')).toHaveTextContent('false');
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    expect(mockSetActiveDashboard).not.toHaveBeenCalled();
  });

  it('passes catalog readiness to the walkthrough instead of queueing goals', async () => {
    await openWalkthroughWith([tab('tab-default-fundamental-fundamentals', 'Fundamentals')], false);

    expect(screen.getByRole('dialog', { name: 'Dashboard walkthrough' })).toHaveAttribute('data-workspace-ready', 'false');
  });
});
