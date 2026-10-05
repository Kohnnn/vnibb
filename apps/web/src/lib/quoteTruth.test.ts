import { fetchStockQuote } from './queries';
import { fetchStockQuote as fetchSplitStockQuote } from './queries/equity';
import { getQuote } from './api';

jest.mock('./api', () => ({ getQuote: jest.fn() }));

const mockGetQuote = jest.mocked(getQuote);

describe('stock quote availability', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects a provider failure rather than exposing a priced trade', async () => {
    mockGetQuote.mockResolvedValue({ data: null, error: 'Quote unavailable: provider offline' });

    await expect(fetchStockQuote('FPT')).rejects.toThrow('Quote unavailable: provider offline');
  });

  it('preserves a reported zero price and zero daily change', async () => {
    mockGetQuote.mockResolvedValue({
      data: {
        symbol: 'FPT', price: 0, open: 0, high: 0, low: 0, prevClose: 0,
        change: 0, changePct: 0, volume: 0, value: 0, updatedAt: '2026-03-14T00:00:00',
      },
    });

    await expect(fetchStockQuote('FPT')).resolves.toMatchObject({ price: 0, change: 0, changePct: 0 });
  });
});

describe.each([
  ['main quote adapter', fetchStockQuote],
  ['split equity quote adapter', fetchSplitStockQuote],
] as const)('%s price unit projection', (_name, fetchQuote) => {
  afterEach(() => jest.clearAllMocks());

  it.each(['VND', 'index_points', 'unknown'] as const)('preserves explicit %s units without changing price', async (price_unit) => {
    mockGetQuote.mockResolvedValue({ data: {
      symbol: 'FPT', price: 57.3, price_unit, open: null, high: null, low: null,
      prevClose: null, change: null, changePct: null, volume: null, value: null, updatedAt: null,
    } });
    await expect(fetchQuote('FPT')).resolves.toMatchObject({ price: 57.3, price_unit });
  });

  it('marks a missing provider unit unknown instead of inferring it by price magnitude', async () => {
    mockGetQuote.mockResolvedValue({ data: {
      symbol: 'FPT', price: 57300, open: null, high: null, low: null,
      prevClose: null, change: null, changePct: null, volume: null, value: null, updatedAt: null,
    } });
    await expect(fetchQuote('FPT')).resolves.toMatchObject({ price: 57300, price_unit: 'unknown' });
  });
});
