import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PolymarketWidget } from './PolymarketWidget';

class JsonTestResponse {
  readonly status: number;
  readonly ok: boolean;

  constructor(private readonly body: string, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.body);
  }
}

Object.defineProperty(globalThis, 'Response', { value: JsonTestResponse, configurable: true });

const makeResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
  });

const backendMarketPayload = {
  count: 2,
  data: [
    {
      source: 'polymarket',
      source_id: 'fed-2026',
      question: 'Will the Fed cut rates in July?',
      category: 'Economics',
      outcomes: ['Yes', 'No'],
      outcome_prices: [0.61, 0.39],
      volume: 1250000,
      liquidity: 820000,
      end_date: '2026-07-31T00:00:00Z',
      url: 'https://polymarket.com/event/fed-2026',
      active: true,
      updated_at: '2026-07-01T10:30:00Z',
    },
    {
      source: 'polymarket',
      source_id: 'world-cup-2026',
      question: 'Will Vietnam qualify for the World Cup?',
      category: 'Sports',
      outcomes: ['Yes', 'No'],
      outcome_prices: [0.18, 0.82],
      volume: 640000,
      liquidity: 210000,
      end_date: '2026-08-15T00:00:00Z',
      url: 'https://polymarket.com/event/world-cup-2026',
      active: true,
      updated_at: '2026-07-01T10:30:00Z',
    },
  ],
};

const legacyMarketPayload = {
  markets: [
    {
      source: 'polymarket',
      sourceId: 'fed-2026',
      question: 'Will the Fed cut rates in July?',
      category: 'economic',
      outcomes: ['Yes', 'No'],
      prices: [0.61, 0.39],
      volume: 1250000,
      liquidity: 820000,
      endDate: '2026-07-31T00:00:00Z',
      url: 'https://polymarket.com/event/fed-2026',
      active: true,
      lastSyncedAt: '2026-07-01T10:30:00Z',
    },
  ],
  freshness: {
    status: 'synced',
    lastSyncedAt: '2026-07-01T10:30:00Z',
    staleAfterSeconds: 900,
  },
};

describe('PolymarketWidget', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('renders loading state while the DB-backed API request is pending', () => {
    // Given: the API request stays pending.
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() => new Promise<Response>(() => undefined));
    global.fetch = fetchMock;

    // When: the widget mounts.
    render(<PolymarketWidget />);

    // Then: the shared loading state is visible.
    expect(screen.getByText('Loading Polymarket markets...')).toBeInTheDocument();
  });

  it('renders economic and sports rows with synced freshness metadata from API data', async () => {
    // Given: the DB-backed API returns economic and sports markets.
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
      Promise.resolve(makeResponse(backendMarketPayload))
    );
    global.fetch = fetchMock;

    // When: the widget loads.
    render(<PolymarketWidget />);

    // Then: rows and metadata render without browser-side provider calls.
    expect(await screen.findByText('Will the Fed cut rates in July?')).toBeInTheDocument();
    expect(screen.getByText('Will Vietnam qualify for the World Cup?')).toBeInTheDocument();
    expect(screen.getByText('Economic')).toBeInTheDocument();
    expect(screen.getByText('Sports')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText(/Last sync Jul 1, 2026/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Will the Fed cut rates in July?' })).toHaveAttribute(
      'href',
      'https://polymarket.com/event/fed-2026'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/prediction-markets?source=polymarket&active=true&limit=20'),
      { cache: 'no-store' }
    );
  });

  it('renders stale freshness metadata when the API marks cached data stale', async () => {
    // Given: the API returns stale cached markets.
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
      Promise.resolve(makeResponse({ ...legacyMarketPayload, freshness: { ...legacyMarketPayload.freshness, status: 'stale' } }))
    );
    global.fetch = fetchMock;

    // When: the widget loads.
    render(<PolymarketWidget />);

    // Then: stale state is visible but market rows still render.
    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Will the Fed cut rates in July?')).toBeInTheDocument();
  });

  it('renders empty state when the API has no markets', async () => {
    // Given: the API returns an empty DB result.
    global.fetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
      Promise.resolve(makeResponse({ count: 0, data: [] }))
    );

    // When: the widget loads.
    render(<PolymarketWidget />);

    // Then: the shared empty state is visible.
    expect(await screen.findByText('No Polymarket markets available')).toBeInTheDocument();
  });

  it('renders retryable error state when the API fails', async () => {
    // Given: the first request fails and the retry succeeds.
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(makeResponse({ detail: 'database unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(makeResponse(backendMarketPayload));
    global.fetch = fetchMock;

    // When: the widget loads and the user retries.
    render(<PolymarketWidget />);
    expect(await screen.findByText('Polymarket data unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    // Then: the retry loads market rows.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Will the Fed cut rates in July?')).toBeInTheDocument();
  });
});
