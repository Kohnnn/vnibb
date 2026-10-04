import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardPage, { DashboardSyncStatusMessage } from './DashboardClient';
import { consumeCopilotStream, openCopilotChatStream } from '@/lib/api';
import type { ResearchStarter, StarterPromptKey } from '@/lib/researchStarters';

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
    state: { dashboards: [] },
    localStateReady: true,
    activeDashboard: null,
    activeTab: null,
    backendSync: { enabled: false, status: 'idle' },
  }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, isAdmin: false }) }));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ setGlobalSymbol: jest.fn() }) }));
jest.mock('@/contexts/SymbolLinkContext', () => ({ useSymbolLink: () => ({ globalSymbol: 'VNM', setGlobalSymbol: jest.fn() }) }));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({ globalMarketsSymbol: 'AMEX:SPY', setGlobalMarketsSymbol: jest.fn() }) }));
jest.mock('@/contexts/UnitContext', () => ({ useUnit: () => ({ config: { display: 'auto' }, setUnit: jest.fn() }) }));
jest.mock('@/hooks/useUrlSync', () => ({ useUrlSync: jest.fn() }));
jest.mock('@/hooks/useResizeNudge', () => ({ useResizeNudge: jest.fn() }));
jest.mock('@/hooks/usePeriodState', () => ({ usePeriodState: () => ({ period: 'FY', setPeriod: jest.fn() }) }));
jest.mock('@/lib/userPreferences', () => ({
  ...jest.requireActual('@/lib/userPreferences'),
  shouldShowDashboardWalkthrough: () => false,
  dispatchOnboardingMeaningfulAction: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/queries', () => ({
  useProfile: () => ({ data: undefined }),
  useStockQuote: () => ({ data: undefined }),
  useFinancialRatios: () => ({ data: undefined }),
}));
jest.mock('@/lib/api', () => ({
  openCopilotChatStream: jest.fn(),
  consumeCopilotStream: jest.fn(),
  getCopilotRuntimeConfig: jest.fn().mockResolvedValue({ provider: 'openrouter', model: 'test-model' }),
}));
jest.mock('@/components/layout', () => ({
  Sidebar: ({ onOpenTemplateSelector }: { onOpenTemplateSelector: () => void }) => <button onClick={onOpenTemplateSelector}>Open templates</button>,
  Header: ({ isAIOpen, onAIClick }: { isAIOpen: boolean; onAIClick: () => void }) => <button onClick={onAIClick}>{isAIOpen ? 'Close VniAgent' : 'Open VniAgent'}</button>,
  RightSidebar: ({ children, overlay }: { children: ReactNode; overlay: boolean }) => <aside aria-label={overlay ? 'Mobile copilot' : 'Desktop copilot'}>{children}</aside>,
  TabBar: () => null,
  MobileNav: () => null,
  FreshnessBanner: () => null,
  WhatsNewPanel: () => null,
}));
jest.mock('@/components/layout/DashboardGrid', () => ({ ResponsiveDashboardGrid: () => null }));
jest.mock('@/components/widgets', () => ({ WidgetWrapper: () => null, WidgetLibrary: () => null, widgetRegistry: {} }));
jest.mock('@/components/modals', () => ({
  WidgetSettingsModal: () => null,
  AppsLibrary: () => null,
  TemplateSelector: ({ open, onStarterPromptRequest }: {
    open: boolean;
    onStarterPromptRequest: (prompt: StarterPromptKey, workflow: ResearchStarter['workflow']) => void;
  }) => open ? <button onClick={() => onStarterPromptRequest('analyze', { id: 'financial-summary', revision: 1 })}>Stage financial starter</button> : null,
}));
jest.mock('@/components/onboarding/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
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

describe('DashboardSyncStatusMessage', () => {
  it('labels local-only persistence as saved on this device', () => {
    render(<DashboardSyncStatusMessage enabled status="local" />);

    expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
    expect(screen.queryByText('Cloud sync failed. Check your connection and refresh to try again.')).not.toBeInTheDocument();
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
