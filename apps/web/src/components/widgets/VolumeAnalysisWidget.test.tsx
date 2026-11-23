import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { useHistoricalPrices } from '@/lib/queries';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse } from '@/types/equity';
import { VolumeAnalysisWidget } from './VolumeAnalysisWidget';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }));

const history = jest.mocked(useHistoricalPrices);
const receipt = Date.parse('2026-11-23T07:00:00Z');
const sessions = [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09',
];

function show(
    inputs: Array<{ close?: unknown; volume?: unknown; time?: string; price_unit?: string }>,
    meta: Record<string, unknown> = {},
    error: Error | null = null,
) {
    history.mockReturnValue({
        data: {
            data: inputs.map((row, index) => ({
                symbol: 'HPG', time: sessions[index], open: 100, high: 110, low: 90,
                close: 100, volume: 100, price_unit: 'VND', ...row,
            })),
            meta: { count: inputs.length, unit_status: 'confirmed_vnd', ...meta },
        },
        isLoading: false, isFetching: false, error, dataUpdatedAt: receipt, refetch: jest.fn(),
    } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
    const publish = jest.fn<void, [WidgetDataPayload]>();
    render(<VolumeAnalysisWidget symbol="HPG" onDataChange={publish} />);
    const payload = publish.mock.lastCall?.[0];
    return { payload, exported: getWidgetExportData(payload) };
}

function bars() {
    return within(screen.getByRole('list', { name: 'Recent volume bars' })).getAllByRole('listitem');
}

beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(receipt); });
afterEach(() => jest.restoreAllMocks());

it('excludes the unknown observation in the two-row reproduction instead of reporting +100%', () => {
    const { exported } = show([{ close: 100, volume: null }, { close: 90, volume: 100 }]);
    expect(screen.getByText('Sample avg: 100')).toBeVisible();
    expect(screen.getByText(/1 valid volume observation.*1 excluded/)).toBeVisible();
    expect(screen.getByText('Latest vs sample avg: unavailable')).toBeVisible();
    expect(within(bars()[0]).getByText('Unknown')).toBeVisible();
    expect(within(bars()[0]).getByRole('img', { name: 'Close direction unknown' })).toBeVisible();
    expect(within(bars()[1]).getByRole('img', { name: 'Close down (-10)' })).toBeVisible();
    expect(exported).toMatchObject({ avgVolume: 100, observationCount: 1, excludedVolumeCount: 1, volumeChangePct: null });
});

it('compares each of the seven declining closes with its immediate predecessor', () => {
    const { exported } = show(Array.from({ length: 7 }, (_, i) => ({ close: 100 - i })));
    expect(bars()).toHaveLength(7);
    expect(within(bars()[0]).getByRole('img', { name: 'Close direction unknown' })).toBeVisible();
    expect(screen.getAllByRole('img', { name: 'Close down (-1)' })).toHaveLength(6);
    expect(screen.getByText(/close vs previous returned bar/i)).toBeVisible();
    expect(screen.queryByText(/High Vol|Low Vol|30-day volume/)).not.toBeInTheDocument();
    expect(exported).toMatchObject({ avgVolume: 100, observationCount: 7, excludedVolumeCount: 0, volumeChangePct: 0 });
});

it.each([1, 10, 11])('uses an unsliced sample for %s returned bars and keeps the first visible predecessor', (count) => {
    const { exported } = show(Array.from({ length: count }, (_, i) => ({ close: 100 + i, volume: 10 * (i + 1) })));
    const visible = bars();
    expect(visible).toHaveLength(Math.min(count, 10));
    expect(within(visible[0]).getByRole('img', {
        name: count === 11 ? 'Close up (+1)' : 'Close direction unknown',
    })).toBeVisible();
    expect(exported).toMatchObject({ avgVolume: ({ 1: 10, 10: 55, 11: 60 })[count], observationCount: count });
});

it('counts measured zero, excludes invalid volumes and does not bridge a missing close', () => {
    const { exported } = show([
        { volume: 0 }, { close: 105, volume: -4 }, { close: 105, volume: Number.NaN },
        { close: null, volume: Infinity }, { close: 109, volume: true }, { close: 108, volume: 1.5 },
        { close: 108, volume: '100' }, { close: 108, volume: undefined }, { close: 109, volume: 100 },
    ]);
    const visible = bars();
    expect(within(visible[0]).getByText('0')).toBeVisible();
    expect(within(visible[1]).getByRole('img', { name: 'Close up (+5)' })).toBeVisible();
    expect(within(visible[2]).getByRole('img', { name: 'Close flat (0)' })).toBeVisible();
    for (const index of [3, 4]) {
        expect(within(visible[index]).getByRole('img', { name: 'Close direction unknown' })).toBeVisible();
    }
    expect(screen.getByText('Sample avg: 50')).toBeVisible();
    expect(screen.getByText('Latest vs sample avg: +100%')).toBeVisible();
    expect(screen.getByText(/Includes the latest returned bar when observed/)).toBeVisible();
    expect(exported).toMatchObject({ avgVolume: 50, observationCount: 2, excludedVolumeCount: 7, volumeChangePct: 100 });
});

it.each([
    { name: 'missing latest', inputs: [{ volume: 100 }, { volume: null }], average: 100, latest: null },
    { name: 'zero baseline', inputs: [{ volume: 0 }, { volume: 0 }], average: 0, latest: 0 },
    { name: 'no observations', inputs: [{ volume: null }, { volume: null }], average: null, latest: null },
])('does not report a percent comparison with $name', ({ inputs, average, latest }) => {
    const { exported } = show(inputs);
    expect(screen.getByText('Latest vs sample avg: unavailable')).toBeVisible();
    expect(screen.getByText(`Sample avg: ${average ?? 'unavailable'}`)).toBeVisible();
    expect(exported).toMatchObject({ avgVolume: average, latestVolume: latest, volumeChangePct: null });
});

it('distinguishes requested, returned and observed ranges and leaves unverified session coverage unknown', () => {
    const { payload, exported } = show([
        { volume: null }, {}, { volume: null },
    ], {
        completeness_status: 'complete', calendar_verified: false,
        freshness_as_of: '2026-10-28', warnings: ['Excluded 20 row(s)'],
    });
    expect(history).toHaveBeenCalledWith('HPG', { startDate: '2026-10-24', endDate: '2026-11-23', interval: '1D' });
    expect(screen.getByText('Requested (calendar): 2026-10-24 to 2026-11-23')).toBeVisible();
    expect(screen.getByText('Returned: 2026-10-26 to 2026-10-28 · 3 bars')).toBeVisible();
    expect(screen.getByText(/Observed: 2026-10-27.*1 valid volume observation.*2 excluded/)).toBeVisible();
    expect(screen.getByText(/Expected sessions: unknown.*Missing sessions: unknown.*Unresolved exclusions: unknown/)).toBeVisible();
    expect(screen.getByText('As of 2026-10-28')).toBeVisible();
    expect(screen.getByText('Source age: 26 calendar days')).toBeVisible();
    expect(payload?.__widgetRuntime?.provenance).toMatchObject({
        updatedAt: '2026-10-28', fetchedAt: receipt, stale: true, coverage: 'partial',
        coverageDetail: { requestedSessions: null, gapSessions: null, observedSessions: 1, calendarVerified: false },
    });
    expect(exported).toMatchObject({ sourceAgeDays: 26, unresolvedSessionCount: null, missingSessionCount: null });
});

it('discloses verified missing sessions separately from unresolved and replaced exclusions', () => {
    const { payload, exported } = show([{}, { time: '2026-10-29' }, { time: '2026-10-30', close: 110 }], {
        calendar_verified: true, expected_session_dates: sessions.slice(0, 5), missing_session_count: 2,
        unresolved_excluded_dates: ['2026-10-28'], unresolved_session_count: 1,
        replaced_excluded_dates: ['2026-10-29'],
    });
    expect(screen.getByText(/Expected sessions: 5.*Missing sessions: 2.*Unresolved exclusions: 1.*Replaced exclusions: 1/)).toBeVisible();
    expect(within(bars()[1]).getByRole('img', { name: 'Close direction unknown' })).toBeVisible();
    expect(within(bars()[2]).getByRole('img', { name: 'Close up (+10)' })).toBeVisible();
    expect(payload?.__widgetRuntime?.provenance?.coverageDetail).toMatchObject({
        requestedSessions: 5, gapSessions: 2, calendarVerified: true,
    });
    expect(exported).toMatchObject({
        missingSessionCount: 2, unresolvedSessionCount: 1,
        unresolvedExcludedDates: ['2026-10-28'], replacedExcludedDates: ['2026-10-29'],
    });
});

it('never promotes a fresh receipt into an as-of date', () => {
    const { payload, exported } = show([{ time: '' }], { freshness_as_of: '2026-11-31' });
    screen.getAllByText('As-of unknown').forEach(element => expect(element).toBeVisible());
    expect(screen.getByText('Source age: unknown')).toBeVisible();
    expect(payload?.__widgetRuntime?.provenance).toMatchObject({ updatedAt: null, fetchedAt: receipt });
    expect(exported).toMatchObject({ sourceAgeDays: null });
});

it('keeps certified history on refresh failure without changing its observation date', () => {
    const { payload } = show([{}], {}, new Error('Refresh failed'));
    expect(screen.getByText('Sample avg: 100')).toBeVisible();
    expect(screen.getByText('As of 2026-10-26')).toBeVisible();
    expect(payload?.__widgetRuntime?.provenance).toMatchObject({ cached: true, stale: true, refreshStatus: 'failed' });
});

it('withholds rows that lack per-row unit certification despite certified response metadata', () => {
    const { exported } = show([{ price_unit: undefined }]);
    expect(screen.getByText(/historical price units were not certified/)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Recent volume bars' })).not.toBeInTheDocument();
    expect(exported).toMatchObject({ avgVolume: null, observationCount: null, excludedVolumeCount: null, returnedCount: 1 });
});
