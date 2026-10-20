import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useForeignTrading } from '@/lib/queries';
import type { ForeignTradingResponse } from '@/types/equity';
import { ForeignTradingWidget, parseForeignTradingSnapshotTime } from './ForeignTradingWidget';

jest.mock('@/lib/queries', () => ({ useForeignTrading: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const mockUseForeignTrading = jest.mocked(useForeignTrading);

describe('parseForeignTradingSnapshotTime', () => {
  it('treats date-only foreign trading rows as 17:00 ICT settlement snapshots', () => {
    expect(parseForeignTradingSnapshotTime('2026-05-28')?.toISOString()).toBe('2026-05-28T10:00:00.000Z');
  });

  it('preserves explicit timestamps', () => {
    expect(parseForeignTradingSnapshotTime('2026-05-28T17:00:00+07:00')?.toISOString()).toBe('2026-05-28T10:00:00.000Z');
  });
});

describe('ForeignTradingWidget volumes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders reported zero Buy and Sell volumes while retaining compact and missing values', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockReturnValue({
      data: {
        symbol: 'FPT', count: 3,
        data: [
          { symbol: 'FPT', date: '2026-05-28', buy_volume: 0, sell_volume: 0 },
          { symbol: 'FPT', date: '2026-05-27', buy_volume: 1000, sell_volume: 0 },
          { symbol: 'FPT', date: '2026-05-26' },
        ],
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-1" symbol="FPT" />);
    await screen.findByText('2026-05-28');

    expect(screen.getByText('Buy')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
    for (const [date, volumes] of [
      ['2026-05-28', ['0', '0']],
      ['2026-05-27', ['1.0K', '0']],
      ['2026-05-26', ['-', '-']],
    ] as const) {
      const row = screen.getByText(date).parentElement!.parentElement!;
      const volumeCells = Array.from(row.children).slice(1, 3);
      expect(volumeCells.map(cell => cell.textContent)).toEqual(volumes);
    }
  });
});
