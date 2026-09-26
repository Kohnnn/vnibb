import { fireEvent, render, screen } from '@testing-library/react';
import { CopilotActionPanel } from './CopilotActionPanel';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { DEFAULT_GROUPS } from '@/types/widget';

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ activeDashboard: null, activeTab: null, addWidget: jest.fn() }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: jest.fn() }));

it('applies a global symbol action to the ticker shared by linked widgets', () => {
  const setGlobalSymbol = jest.fn();
  jest.mocked(useWidgetGroups).mockReturnValue({
    globalSymbol: 'VCB', setGlobalSymbol, groups: DEFAULT_GROUPS,
    getSharedGroups: jest.fn(), setGroupSymbol: jest.fn(), getSymbolForGroup: jest.fn(),
    getColorForGroup: jest.fn(), tickerOverrideFor: jest.fn(),
    setWidgetTickerOverride: jest.fn(), clearWidgetTickerOverride: jest.fn(),
  });
  render(<CopilotActionPanel actions={[{
    id: 'symbol-change', type: 'set_global_symbol', label: 'Switch symbol', payload: { symbol: 'HPG' },
  }]} />);

  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  expect(setGlobalSymbol).toHaveBeenCalledWith('HPG');
  expect(screen.getByText('Switched to HPG')).toBeInTheDocument();
});
