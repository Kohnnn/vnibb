import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useFinancialRatios, useHistoricalPrices, useStockQuote, type StockQuoteView } from '@/lib/queries';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse, FinancialRatiosResponse } from '@/types/equity';
import { QuickStatsWidget } from './QuickStatsWidget';

jest.mock('@/lib/queries', () => ({
    useHistoricalPrices: jest.fn(),
    useStockQuote: jest.fn(),
    useFinancialRatios: jest.fn(),
}));

const settled = { isLoading: false, isFetching: false, error: null, dataUpdatedAt: 1750000000000 };

function mockHistory(volumes: unknown[], certified = true) {
    jest.mocked(useHistoricalPrices).mockReturnValue({
        ...settled,
        data: {
            data: volumes.map((volume, i) => ({
                symbol: 'FPT', time: `2025-06-${String(i + 1).padStart(2, '0')}`,
                open: 100, high: 120, low: 80, close: 110, volume,
                price_unit: certified ? 'VND' : undefined,
            })),
            meta: { count: volumes.length, unit_status: 'confirmed_vnd' },
        },
    } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
}

beforeEach(() => {
    jest.mocked(useStockQuote).mockReturnValue({
        ...settled,
        data: { symbol: 'FPT', price: 110, volume: 0 },
    } as unknown as UseQueryResult<StockQuoteView, Error>);
    jest.mocked(useFinancialRatios).mockReturnValue(settled as UseQueryResult<FinancialRatiosResponse, Error>);
});

it('averages only observed returned volumes without replacing a quoted zero', () => {
    mockHistory([null, 2_000_000]);
    const publish = jest.fn<void, [WidgetDataPayload]>();
    render(<QuickStatsWidget symbol="FPT" onDataChange={publish} />);

    expect(screen.getByText('2M')).toBeVisible();
    expect(screen.getByText('1 of 2 returned bars observed · 1 excluded')).toBeVisible();
    expect(screen.getByText('Quote volume: 0')).toBeVisible();
    const payload = publish.mock.lastCall?.[0];
    expect(payload?.__widgetRuntime?.provenance?.basis).toMatch(/mean of observed volume/i);
    expect(getWidgetExportData(payload)).toMatchObject({
        avgVolume: 2_000_000, observationCount: 1, excludedVolumeCount: 1, quoteVolume: 0,
    });
});

it('includes measured zero but excludes invalid volumes from the mean', () => {
    mockHistory([0, 2_000_000, -1, Number.NaN, Number.POSITIVE_INFINITY, '3000', undefined, 1.5]);
    const publish = jest.fn<void, [WidgetDataPayload]>();
    render(<QuickStatsWidget symbol="FPT" onDataChange={publish} />);

    expect(screen.getByText('1M')).toBeVisible();
    expect(screen.getByText('2 of 8 returned bars observed · 6 excluded')).toBeVisible();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({
        avgVolume: 1_000_000, observationCount: 2, excludedVolumeCount: 6,
    });
});

it('updates the export from a measured zero mean to unavailable when coverage is lost', () => {
    const publish = jest.fn<void, [WidgetDataPayload]>();
    mockHistory([0, 0]);
    const widget = <QuickStatsWidget symbol="FPT" onDataChange={publish} />;
    const { rerender } = render(widget);

    expect(screen.getByText('0', { exact: true })).toBeVisible();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({
        avgVolume: 0, observationCount: 2, excludedVolumeCount: 0,
    });

    mockHistory([null, null]);
    rerender(<QuickStatsWidget symbol="FPT" onDataChange={publish} />);
    expect(screen.getByText('Avg Volume').parentElement?.nextElementSibling).toHaveTextContent('n/a');
    expect(screen.getByText('0 of 2 returned bars observed · 2 excluded')).toBeVisible();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({
        avgVolume: null, observationCount: 0, excludedVolumeCount: 2, quoteVolume: 0,
    });
});

it('does not admit observed volume from uncertified historical prices', () => {
    mockHistory([2_000_000], false);
    const publish = jest.fn<void, [WidgetDataPayload]>();
    render(<QuickStatsWidget symbol="FPT" onDataChange={publish} />);

    expect(screen.getByText('Historical price units were not certified.')).toBeVisible();
    expect(screen.queryByText('2M')).not.toBeInTheDocument();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({
        avgVolume: null, observationCount: null, excludedVolumeCount: null, quoteVolume: 0,
    });
});
