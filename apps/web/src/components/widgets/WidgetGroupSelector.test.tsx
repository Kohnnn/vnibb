import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';

import { WidgetWrapper } from './WidgetWrapper';
import { WidgetGroupProvider, useWidgetGroups } from '@/contexts/WidgetGroupContext';
// The wrapper reads a widget's persisted config from dashboard state, so the
// scope a workspace would have saved is injected here rather than as a prop.
let persistedWidgetConfig: Record<string, unknown> = {};

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({
    state: {
      dashboards: [
        {
          id: 'dashboard',
          isEditable: true,
          tabs: [{ id: 'tab', widgets: [{ id: 'alpha', type: 'screener', layout: { x: 0, y: 0, w: 12, h: 8 }, config: persistedWidgetConfig }] }],
        },
      ],
    },
    updateWidget: jest.fn(),
  }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({
  useGlobalMarketsSymbol: () => ({ setGlobalMarketsSymbol: jest.fn() }),
}));
jest.mock('@/lib/queries', () => ({ useProfile: () => ({ data: undefined }) }));
jest.mock('@/lib/dashboardIntelligence', () => ({ getWidgetLayoutInsight: () => null }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: () => null }));

const DASHBOARD_ID = 'dashboard';
const TAB_ID = 'tab';

/**
 * Drives the same group-ticker path the workspace uses (`setGlobalSymbol` on
 * the real provider) and re-renders the widget, standing in for the dashboard
 * re-rendering its widgets when a group ticker changes.
 */
let driveGroupTicker: (symbol: string) => void = () => {};

interface HarnessOptions {
  id?: string;
  widgetGroup?: 'global' | 'A' | 'B' | 'C' | 'D';
}

function AlphaWidget({
  id = 'alpha',
  widgetGroup = 'global',
}: HarnessOptions) {
  const { setGlobalSymbol } = useWidgetGroups();
  const [onSymbolChange] = React.useState(() => jest.fn());
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    driveGroupTicker = (symbol: string) => {
      setGlobalSymbol(symbol);
      setTick((value) => value + 1);
    };
  }, [setGlobalSymbol]);

  return (
    <WidgetWrapper
      id={id}
      title="Alpha widget"
      widgetType="screener"
      dashboardId={DASHBOARD_ID}
      tabId={TAB_ID}
      widgetGroup={widgetGroup}
      showGroupLabels
      onSymbolChange={onSymbolChange}
    >
      <span data-testid={`body-${id}`}>alpha</span>
    </WidgetWrapper>
  );
}

function Harness(options: HarnessOptions) {
  return (
    <WidgetGroupProvider>
      <AlphaWidget {...options} />
    </WidgetGroupProvider>
  );
}

/** Opens the group picker and returns a `within` scope for its menu. */
async function openGroupMenu(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  return within(screen.getByRole('menu'));
}

async function detachWidget(user: UserEvent) {
  const menu = await openGroupMenu(user);
  await user.click(menu.getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(menu.getByRole('menuitem', { name: 'Keep ticker in this widget' }));
}

async function followGroup(user: UserEvent) {
  const menu = await openGroupMenu(user);
  await user.click(menu.getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(menu.getByRole('menuitem', { name: /^Follow / }));
}

async function changeGroupTo(user: UserEvent, groupName: string) {
  const menu = await openGroupMenu(user);
  await user.click(menu.getByRole('menuitem', { name: new RegExp(`^${groupName} · `) }));
}

describe('WidgetGroupSelector ticker scope', () => {
  beforeEach(() => {
    window.localStorage.clear();
    persistedWidgetConfig = {};
  });

  it('starts following its group and adopts the new ticker when the group changes', async () => {
    const user = userEvent.setup();
    render(<Harness widgetGroup="global" />);

    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker shared');
    expect(screen.getByTestId('ticker-scope-badge')).not.toHaveTextContent('Ticker local');

    await changeGroupTo(user, 'Global');
    React.act(() => { driveGroupTicker('FPT'); });

    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker shared');
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    await changeGroupTo(user, 'Group A');
    expect(screen.getByRole('button', { name: /Ticker group: Group A/ })).toBeInTheDocument();
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker shared');
  });

  it('keeps its own ticker across a group change once detached, and follows again after reset', async () => {
    const user = userEvent.setup();
    render(<Harness widgetGroup="global" />);

    await changeGroupTo(user, 'Global');
    React.act(() => { driveGroupTicker('FPT'); });
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    await detachWidget(user);
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker local');
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    // A detached widget ignores later moves of its group's ticker.
    React.act(() => { driveGroupTicker('VNM'); });
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker local');
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    // ...and stays put when it is moved into another group.
    await changeGroupTo(user, 'Group A');
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker local');
    expect(screen.getByRole('button', { name: /Ticker group: Group A/ })).toBeInTheDocument();
    expect(screen.getByTitle(/^Group A · FPT/)).toBeInTheDocument();

    await followGroup(user);
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker shared');
    // Reset re-attaches to the group the widget now belongs to, so it takes
    // Group A's own ticker rather than the global one it was detached from.
    expect(screen.getByTitle(/^Group A · VCI/)).toBeInTheDocument();
  });

  it('restores the group ticker on reset after the group moved on', async () => {
    const user = userEvent.setup();
    render(<Harness widgetGroup="global" />);

    await changeGroupTo(user, 'Global');
    React.act(() => { driveGroupTicker('FPT'); });
    await detachWidget(user);

    React.act(() => { driveGroupTicker('VNM'); });
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    await followGroup(user);
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker shared');
    expect(screen.getByTitle(/^Global · VNM/)).toBeInTheDocument();
  });

  it('reopens a widget detached when its config persisted an override scope', async () => {
    const user = userEvent.setup();
    persistedWidgetConfig = { tickerScope: 'override', symbol: 'FPT' };
    render(<Harness widgetGroup="global" />);

    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker local');
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    React.act(() => { driveGroupTicker('VNM'); });
    expect(screen.getByTitle(/^Global · FPT/)).toBeInTheDocument();

    await followGroup(user);
    expect(screen.getByTestId('ticker-scope-badge')).toHaveTextContent('Ticker shared');
    expect(screen.getByTitle(/^Global · VNM/)).toBeInTheDocument();
  });

  it('labels every group entry with the ticker that picking it would apply', async () => {
    const user = userEvent.setup();
    render(<Harness widgetGroup="global" />);

    const menu = await openGroupMenu(user);
    expect(menu.getByRole('menuitem', { name: 'Global · VCI' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Group A · VCI' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Group B · VCI' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Group C · VCI' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Group D · VCI' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Global · VCI' })).toHaveTextContent('current');
  });
});
