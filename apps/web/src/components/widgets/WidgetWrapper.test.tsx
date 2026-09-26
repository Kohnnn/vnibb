import React, { createContext, useContext, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WidgetWrapper } from './WidgetWrapper';
import { DEFAULT_GROUPS } from '@/types/widget';

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({
    state: { dashboards: [{ id: 'dashboard', isEditable: true, tabs: [{ id: 'tab', widgets: [{ id: 'screener', type: 'screener', layout: { x: 0, y: 0, w: 12, h: 8 }, config: {} }] }] }] },
    addWidget: jest.fn(), cloneWidget: jest.fn(), updateWidget: jest.fn(),
  }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({
    groups: DEFAULT_GROUPS,
    getColorForGroup: () => '#fff',
    getSymbolForGroup: () => 'VCI',
    setGroupSymbol: jest.fn(),
    tickerOverrideFor: () => null,
    setWidgetTickerOverride: jest.fn(),
    clearWidgetTickerOverride: jest.fn(),
  }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({ setGlobalMarketsSymbol: jest.fn() }) }));
jest.mock('@/lib/queries', () => ({ useProfile: () => ({ data: undefined }) }));
jest.mock('@/lib/dashboardIntelligence', () => ({ getWidgetLayoutInsight: () => null }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: () => null }));

const FilterContext = createContext({ filter: '', saveFilter: (_value: string) => {} });

function FilterEditor() {
  const { filter, saveFilter } = useContext(FilterContext);
  return <input aria-label="Screener search" value={filter} onChange={event => saveFilter(event.target.value)} />;
}

function WorkspaceHarness() {
  const [filter, saveFilter] = useState('');
  return <FilterContext.Provider value={{ filter, saveFilter }}>
    <output aria-label="Saved screener filter">{filter}</output>
    <WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" showGroupLabels={false}>
      <FilterEditor />
    </WidgetWrapper>
  </FilterContext.Provider>;
}

test('maximized edits have a single live editor and survive restoring the original cell', async () => {
  const user = userEvent.setup();
  render(<WorkspaceHarness />);
  await user.type(screen.getByRole('textbox', { name: 'Screener search' }), 'V');
  await user.click(screen.getByRole('button', { name: 'Maximize widget' }));
  const dialog = screen.getByRole('dialog', { name: 'VCI - Screener' });
  const liveEditors = screen.getAllByRole('textbox', { name: 'Screener search', hidden: true });
  expect(liveEditors).toHaveLength(1);
  expect(liveEditors[0]).toHaveValue('V');
  await user.click(within(dialog).getByRole('textbox', { name: 'Screener search' }));
  await user.type(screen.getByLabelText('Screener search'), 'CB');
  expect(screen.getByLabelText('Saved screener filter')).toHaveTextContent('VCB');
  await user.click(within(dialog).getByRole('button', { name: 'Minimize widget' }));
  expect(screen.getAllByRole('textbox', { name: 'Screener search', hidden: true })).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Screener search' })).toHaveValue('VCB');
});
