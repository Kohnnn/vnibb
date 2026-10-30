import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SectorBoardResponse } from '@/lib/api';
import { render, screen, within } from '@testing-library/react';
import { useSectorBoard } from '@/lib/queries';
import { SectorBoardWidget } from './SectorBoardWidget';

jest.mock('@/lib/queries', () => ({ useSectorBoard: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }));
jest.mock('@/contexts/UnitContext', () => ({ useUnit: () => ({ config: { display: 'VND' } }) }));
jest.mock('@/components/ui/WidgetContainer', () => ({ WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockUseSectorBoard = jest.mocked(useSectorBoard);

function setSectors(sectors: { name: string; change_pct: number | null; stocks: never[] }[]) {
  // The fixture supplies only the query fields consumed by the widget.
  mockUseSectorBoard.mockReturnValue({
    data: { sectors, market_summary: {}, sort_by: 'volume', limit_per_sector: 12 },
    isLoading: false, isFetching: false, error: null, dataUpdatedAt: 0, refetch: jest.fn(),
  } as unknown as UseQueryResult<SectorBoardResponse, Error>);
}

test('ranks known negative returns ahead of unknown sectors and displays unknown neutrally', () => {
  setSectors([
    { name: 'Unknown', change_pct: null, stocks: [] },
    { name: 'Declining', change_pct: -2, stocks: [] },
    { name: 'Weaker', change_pct: -4, stocks: [] },
  ]);
  render(<SectorBoardWidget id="sector-board" />);
  expect(screen.getByText(/strongest Declining \(-2.00%\)/)).toHaveTextContent('weakest Weaker (-4.00%)');
  const header = screen.getByText('Unknown').parentElement!;
  const unavailable = within(header).getByText('Unavailable');
  expect(unavailable).toHaveClass('text-[var(--text-muted)]');
  expect(unavailable).not.toHaveClass('text-emerald-300');
  expect(header).not.toHaveTextContent('+—%');
});

test('does not name leaders when every sector return is unknown', () => {
  setSectors([{ name: 'Unknown', change_pct: null, stocks: [] }]);
  render(<SectorBoardWidget id="sector-board" />);
  expect(screen.getByText(/strongest Unavailable/)).toHaveTextContent('weakest Unavailable');
});
