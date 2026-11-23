import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { provenanceToMarkdown } from '@/lib/widgetProvenance';
import type { EquityHistoricalResponse } from '@/types/equity';
import { VolumeDeltaWidget } from './VolumeDeltaWidget';
import { VolumeProfileWidget } from './VolumeProfileWidget';

const receivedAt = '2026-11-23T06:55:00Z';
const printAt = '2026-11-23T13:37:20+07:00';
const originalFetch = global.fetch;

function response({
  ticks = true, depth = false, inputErrors = {} as Record<string, string>, legacy = false,
  error: envelopeError, tickStatus,
}: { ticks?: boolean; depth?: boolean; inputErrors?: Record<string, string>; legacy?: boolean;
  error?: string; tickStatus?: string } = {}) {
  const profilePrice = depth ? 27_000 : ticks ? 25_000 : null;
  const labels: Record<string, string> = { trade_ticks: 'Trade ticks', price_depth: 'Price depth', daily_prices: 'Daily prices' };
  return {
    error: envelopeError ?? (Object.entries(inputErrors).map(([input, error]) => `${labels[input]}: ${error}`).join('; ') || null),
    data: {
      deep_trades: { bars: ticks ? [{ time: '2026-11-23T13:35:00+07:00', delta: 400, cumulative_delta: 400 }] : [] },
      volume_profile: {
        quality: depth ? 'volume_at_price' : ticks ? 'trade_ticks' : 'unavailable',
        bins: profilePrice === null ? [] : [{ price: profilePrice, volume: 400 }],
        poc_price: profilePrice, vah_price: profilePrice, val_price: profilePrice,
      },
      data_quality: { deep_trades: ticks ? 'match_type_proxy' : 'unavailable' },
      price_action: { candles: [] },
      vwap: { points: [] },
      footprint: { bars: [] },
    },
    meta: {
      ...(!legacy && { input_errors: inputErrors, trade_as_of_basis: ticks ? 'admitted_trade_time' : null }),
      feed: {
        status: tickStatus ?? (inputErrors.trade_ticks ? 'timeout' : ticks ? 'available' : 'empty'),
        fetched_at: receivedAt, source_as_of: ticks ? printAt : null, delivery: 'retained', fallback: false,
      },
    },
  };
}

type Reply = { data: unknown } | 'network';

function renderVolumes(responses: Reply[], history: EquityHistoricalResponse[] = [{ data: [] }]) {
  const read = jest.fn(async () => responses[responses.length - 1]);
  for (const body of responses) read.mockResolvedValueOnce(body);
  const readHistory = jest.fn(async () => history[history.length - 1]);
  for (const body of history) readHistory.mockResolvedValueOnce(body);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://offline.test').pathname;
    if (/\/equity\/historical$/.test(path)) return { ok: true, json: () => readHistory() } as Response;
    if (!path.endsWith('/microstructure/HPG')) throw new Error(`Unexpected request: ${path}`);
    const body = await read();
    if (body === 'network') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const onDelta = jest.fn();
  const onProfile = jest.fn();
  render(<QueryClientProvider client={client}>
    <section aria-label="Volume Delta"><VolumeDeltaWidget symbol="HPG" onDataChange={onDelta} /></section>
    <section aria-label="Volume Profile"><VolumeProfileWidget symbol="HPG" onDataChange={onProfile} /></section>
  </QueryClientProvider>);
  return {
    delta: within(screen.getByRole('region', { name: 'Volume Delta' })),
    profile: within(screen.getByRole('region', { name: 'Volume Profile' })),
    refresh: () => act(async () => { await client.refetchQueries({ queryKey: ['microstructure'] }); }),
    onDelta, onProfile,
  };
}

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(receivedAt) + 5_000));
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

it('retains tick delta on HTTP 200 timeout without discarding the successful depth profile', async () => {
  const { delta, profile, refresh, onDelta, onProfile } = renderVolumes([
    response(), response({ ticks: false, depth: true, inputErrors: { trade_ticks: 'Request timed out' } }),
  ]);
  expect(await delta.findByText('Volume Delta (Mongo)')).toBeVisible();
  expect(delta.getByText('Observed')).toBeVisible();
  const asOf = delta.getByText(/^As of /).textContent!;
  expect((await profile.findAllByText('25000.00')).length).toBeGreaterThan(0);

  await refresh();

  expect(await delta.findByText('Trade ticks: Request timed out')).toBeVisible();
  expect(delta.getByText('Today').parentElement).toHaveTextContent('+400');
  expect(delta.getByText(asOf)).toBeVisible();
  expect((await profile.findAllByText('27000.00')).length).toBeGreaterThan(0);
  expect(profile.getByRole('status')).toHaveTextContent('Trade ticks: Request timed out');
  expect(profile.queryByText(/^(Live|Cached|Refresh failed)$/)).not.toBeInTheDocument();
  expect(onProfile.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    updatedAt: null, refreshStatus: 'succeeded', cached: false, sourceLabel: 'Volume profile · volume at price',
    warnings: ['Trade ticks: Request timed out'],
  });
  expect(onDelta).toHaveBeenLastCalledWith(expect.objectContaining({
    __widgetRuntime: expect.objectContaining({
      provenance: expect.objectContaining({ updatedAt: printAt, refreshStatus: 'failed' }),
    }),
  }));
});

it.each([false, true])('retains failed depth without reviving a successful empty tape (legacy=%s)', async (legacy) => {
  const { delta, profile, refresh, onDelta, onProfile } = renderVolumes([
    response({ depth: true }), response({ ticks: false, inputErrors: { price_depth: 'Request timed out' }, legacy }),
  ]);
  expect(await delta.findByText('Volume Delta (Mongo)')).toBeVisible();
  expect((await profile.findAllByText('27000.00')).length).toBeGreaterThan(0);

  await refresh();

  expect(await profile.findByText('Price depth: Request timed out')).toBeVisible();
  expect(profile.getAllByText('27000.00').length).toBeGreaterThan(0);
  expect(await delta.findByText('Not enough historical candles')).toBeVisible();
  expect(delta.queryByText(/Request timed out/i)).not.toBeInTheDocument();
  expect(onDelta.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    apiGroup: '/equity', refreshStatus: 'succeeded', observationStatus: 'empty',
  });
  expect(onProfile.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    updatedAt: null, refreshStatus: 'failed', cached: true,
  });
});

it('publishes retained depth profile provenance after a rejected transport refresh', async () => {
  const { profile, refresh, onProfile } = renderVolumes([response({ ticks: false, depth: true }), 'network']);
  expect(await profile.findByTitle('27000.00')).toBeVisible();
  expect(onProfile.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    refreshStatus: 'succeeded', cached: false, intraday: { fallback: false },
  });

  await refresh();

  expect(await profile.findByRole('status')).toHaveTextContent('Network error. Unable to connect to the server.');
  expect(profile.getByTitle('27000.00')).toBeVisible();
  const provenance = onProfile.mock.lastCall?.[0].__widgetRuntime.provenance;
  expect(provenance).toMatchObject({
    sourceLabel: 'Volume profile · volume at price', observationStatus: 'available', refreshStatus: 'failed', cached: true,
    intraday: { feedStatus: 'unavailable', delivery: 'retained', fallback: true },
  });
  expect(provenanceToMarkdown(provenance)).toContain('Retained fallback: true');
});

it('does not mark an empty profile as retained after a rejected transport refresh', async () => {
  const { profile, refresh, onProfile } = renderVolumes([response({ ticks: false }), 'network']);
  expect(await profile.findByText('No volume profile data')).toBeVisible();

  await refresh();

  expect(await profile.findByText('Volume profile unavailable')).toBeVisible();
  expect(onProfile.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    observationStatus: 'unavailable', refreshStatus: 'failed', cached: false,
    intraday: { feedStatus: 'unavailable', fallback: false },
  });
});

it.each([false, true])('replaces previous observations with genuinely empty reads (legacy=%s)', async (legacy) => {
  const { delta, profile, refresh, onDelta, onProfile } = renderVolumes([
    response({ depth: true }), response({ ticks: false, legacy }),
  ]);
  expect(await delta.findByText('Volume Delta (Mongo)')).toBeVisible();
  expect((await profile.findAllByText('27000.00')).length).toBeGreaterThan(0);

  await refresh();

  expect(await delta.findByText('Not enough historical candles')).toBeVisible();
  expect(await profile.findByText('No volume profile data')).toBeVisible();
  expect(screen.queryByText(/unavailable|Cached|27000\.00|Volume Delta \(Mongo\)/i)).not.toBeInTheDocument();
  for (const publish of [onDelta, onProfile]) {
    expect(publish.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
      updatedAt: null, refreshStatus: 'succeeded', observationStatus: 'empty', cached: false, warnings: [],
    });
  }
});

it('discloses a partial error with no previous observations instead of rendering a normal empty state', async () => {
  const { delta } = renderVolumes([response({ ticks: false, inputErrors: { trade_ticks: 'Request timed out' } })]);
  expect(await delta.findByText('Volume delta unavailable')).toBeVisible();
  expect(delta.queryByText('Not enough historical candles')).not.toBeInTheDocument();
});

it('uses current tick bins when depth is rejected and describes the alternate failure separately', async () => {
  const { profile, onProfile } = renderVolumes([
    response({ inputErrors: { price_depth: 'The feed returned no usable observations' } }),
  ]);
  expect(await profile.findByText('Observed')).toBeVisible();
  expect(profile.getByRole('status')).toHaveTextContent('Price depth: The feed returned no usable observations');
  expect(profile.queryByText(/^(Live|Cached|Refresh failed)$/)).not.toBeInTheDocument();
  expect(onProfile.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    updatedAt: printAt, fetchedAt: receivedAt, refreshStatus: 'succeeded', coverage: 'unknown',
    intraday: { delivery: 'retained', fallback: false, feedStatus: 'available' },
    warnings: ['Price depth: The feed returned no usable observations'],
  });
});

it('attributes an unavailable profile to depth when the tick read succeeds empty', async () => {
  const { profile, onProfile } = renderVolumes([
    response({ ticks: false, inputErrors: { price_depth: 'The feed returned no usable observations' } }),
  ]);
  expect(await profile.findByText('Volume profile unavailable')).toBeVisible();
  expect(profile.getByText(/The feed returned no usable observations/)).toBeVisible();
  expect(onProfile.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    apiGroup: '/microstructure', sourceLabel: 'Volume profile · volume at price',
    updatedAt: null, refreshStatus: 'failed', observationStatus: 'unavailable',
  });
});

it('never certifies an old emitted clock or borrows it when retaining tick bars', async () => {
  const { delta, profile, refresh, onDelta, onProfile } = renderVolumes([
    response({ legacy: true }), response({ ticks: false, inputErrors: { trade_ticks: 'Request timed out' } }),
  ]);
  expect(await delta.findByText('Volume Delta (Mongo)')).toBeVisible();
  expect(await profile.findByText('Mongo • trade_ticks')).toBeVisible();
  expect(profile.getAllByText('As-of unknown').length).toBeGreaterThan(0);
  expect(delta.getAllByText('As-of unknown').length).toBeGreaterThan(0);
  expect(screen.queryByText(/^(Live|Observed)$/)).not.toBeInTheDocument();

  await refresh();

  expect(await delta.findByRole('status')).toHaveTextContent('Trade ticks: Request timed out');
  expect(delta.getByText('Today').parentElement).toHaveTextContent('+400');
  for (const publish of [onDelta, onProfile]) {
    expect(publish.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
      updatedAt: null, fetchedAt: receivedAt, refreshStatus: 'failed',
    });
  }
});

it('does not scope an unattributed legacy error to a successful empty tick read', async () => {
  const { delta, refresh, onDelta } = renderVolumes([
    response(), response({ ticks: false, legacy: true, error: 'Request timed out' }),
  ]);
  expect(await delta.findByText('Volume Delta (Mongo)')).toBeVisible();
  await refresh();
  expect(await delta.findByText('Not enough historical candles')).toBeVisible();
  expect(delta.queryByText('Volume Delta (Mongo)')).not.toBeInTheDocument();
  expect(onDelta.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
    refreshStatus: 'succeeded', observationStatus: 'empty', warnings: ['Request timed out'],
  });
});

it('attributes an unsuccessful historical attempt after an empty microstructure read', async () => {
  const { delta, profile, onDelta, onProfile } = renderVolumes([
    response({ ticks: false }),
  ], [{ data: [], error: 'Historical source unavailable' }]);
  expect(await delta.findByText('Volume delta unavailable')).toBeVisible();
  expect(await profile.findByText('Volume profile unavailable')).toBeVisible();
  for (const publish of [onDelta, onProfile]) {
    expect(publish.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
      apiGroup: '/equity', updatedAt: null, refreshStatus: 'failed', observationStatus: 'unavailable',
      warnings: ['Historical source unavailable'],
    });
  }
});

it('does not mark observed ticks stale because an alternate historical read failed', async () => {
  const { delta, profile, onDelta, onProfile } = renderVolumes([
    response(),
  ], [{ data: [], error: 'Historical source unavailable' }]);
  for (const widget of [delta, profile]) {
    expect(await widget.findByText('Observed')).toBeVisible();
    expect(await widget.findByRole('status')).toHaveTextContent('Historical prices: Historical source unavailable');
    expect(widget.queryByText(/^(Live|Stale|Cached|Refresh failed)$/)).not.toBeInTheDocument();
  }
  for (const publish of [onDelta, onProfile]) {
    expect(publish.mock.lastCall?.[0].__widgetRuntime.provenance).toMatchObject({
      apiGroup: '/microstructure', updatedAt: printAt, fetchedAt: receivedAt,
      refreshStatus: 'succeeded', observationStatus: 'available', cached: false,
      warnings: ['Historical prices: Historical source unavailable'],
    });
  }
});
