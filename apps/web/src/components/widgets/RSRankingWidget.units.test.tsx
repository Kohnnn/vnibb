import type { UseQueryResult } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'

import type { RSGainersResponse, RSLeadersResponse } from '@/lib/api'
import { useRSGainers, useRSLeaders, useRSLaggards } from '@/lib/queries'
import type { WidgetDataPayload } from '@/lib/widgetRuntime'
import { describeRSPrice, RSRankingWidget } from './RSRankingWidget'

jest.mock('@/lib/queries', () => ({
    useRSLeaders: jest.fn(),
    useRSLaggards: jest.fn(),
    useRSGainers: jest.fn(),
}))
jest.mock('@/hooks/useWidgetSymbolLink', () => ({
    useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}))

const mockLeaders = jest.mocked(useRSLeaders)
const mockLaggards = jest.mocked(useRSLaggards)
const mockGainers = jest.mocked(useRSGainers)

function query<T>(data: T | undefined): UseQueryResult<T, Error> {
    return {
        data,
        isLoading: !data,
        error: null,
        refetch: jest.fn(),
        isFetching: false,
        dataUpdatedAt: 0,
    } as unknown as UseQueryResult<T, Error>
}

// Fixtures reproduce the two helper outputs from the ticket, plus the index,
// zero/null and stale cases the acceptance criteria call for.
const leaders: RSLeadersResponse = {
    total: 6,
    leaders: [
        { symbol: 'TBX', rs_rating: 95, rs_rank: 1, price: 10000, price_unit: 'VND', price_source: 'vnstock_vnd:KBS', price_asof: '2026-03-09', rating_asof: '2026-03-10' },
        { symbol: 'THD', rs_rating: 90, rs_rank: 2, price: 113.5, price_unit: 'unknown', price_asof: '2026-03-10', rating_asof: '2026-03-10' },
        { symbol: 'VNINDEX', rs_rating: 88, rs_rank: 3, price: 1240.5, price_unit: 'index_points', price_asof: '2026-03-10', rating_asof: '2026-03-10' },
        { symbol: 'HII', rs_rating: 85, rs_rank: 4, price: 0, price_unit: 'VND', rating_asof: '2026-03-10' },
        { symbol: 'MSR', rs_rating: 84, rs_rank: 5, price: null, price_unit: 'unknown', rating_asof: '2026-03-10' },
        // Carried forward from an undated seed: priced, but with no trade date.
        { symbol: 'VND', rs_rating: 83, rs_rank: 6, price: 1000, price_unit: 'VND', price_asof: null, rating_asof: '2026-03-10' },
    ],
}

const gainers: RSGainersResponse = {
    total: 1,
    lookback_days: 7,
    gainers: [
        { symbol: 'THD', rs_rating: 90, rs_rating_prev: 70, rs_rating_change: 20, price: 113.5, price_unit: 'unknown', price_asof: '2026-03-10', rating_asof: '2026-03-10' },
    ],
}

beforeEach(() => {
    mockLeaders.mockReturnValue(query(leaders))
    mockLaggards.mockReturnValue(query({ total: 0, laggards: [] }))
    mockGainers.mockReturnValue(query(gainers))
})

function renderWidget(onDataChange?: (payload: WidgetDataPayload) => void) {
    return render(<RSRankingWidget onDataChange={onDataChange} />)
}

test('renders a unit with every price and withholds an unverified unit', () => {
    renderWidget()

    // Certified VND: the value and its unit travel together.
    const tbx = screen.getByTestId('rs-price-TBX')
    expect(tbx).toHaveTextContent('10,000')
    expect(tbx).toHaveTextContent('VND')

    // Index points stay distinguishable from currency.
    const vnindex = screen.getByTestId('rs-price-VNINDEX')
    expect(vnindex).toHaveTextContent('1,240.5')
    expect(vnindex).toHaveTextContent('pts')

    // Unknown unit: no bare magnitude that could be read as VND.
    const thd = screen.getByTestId('rs-price-THD')
    expect(thd).toHaveTextContent('n/a')
    expect(thd).not.toHaveTextContent('113.5')
    expect(thd.getAttribute('title')).toMatch(/no verified currency or scale/)

    // Zero is reported as unavailable, not as a zero price.
    const hii = screen.getByTestId('rs-price-HII')
    expect(hii).toHaveTextContent('n/a')
    expect(hii).not.toHaveTextContent('VND')

    // A missing observation is unavailable, not unknown-unit copy.
    const msr = screen.getByTestId('rs-price-MSR')
    expect(msr).toHaveTextContent('n/a')
    expect(msr.getAttribute('title')).toMatch(/no stored price observation/)

    // A carried-forward price without its own trade date still renders, but says
    // the observation date is unknown rather than borrowing the ranking date.
    const undated = screen.getByTestId('rs-price-VND')
    expect(undated).toHaveTextContent('1,000')
    expect(undated).toHaveTextContent('VND')
    expect(undated.getAttribute('title')).toMatch(/observation date unknown/)
    expect(undated.getAttribute('title')).not.toMatch(/2026-03-10/)
})

test('discloses the price and rating observation dates instead of the fetch time', () => {
    const publications: WidgetDataPayload[] = []
    renderWidget((payload) => publications.push(payload))

    expect(screen.getByText(/price as of 2026-03-10/)).toBeInTheDocument()
    expect(screen.getByText(/As of/)).toBeInTheDocument()

    // THD carries a value with an unverified unit; VND carries a price with no
    // trade date; MSR has no observation at all.
    expect(publications[publications.length - 1]).toMatchObject({
        unknownUnitCount: 1,
        undatedPriceCount: 1,
        priceAsOf: '2026-03-10',
        __widgetRuntime: {
            layoutHint: { empty: false },
            // Source observation, not the retrieval receipt (`fetchedAt`).
            provenance: { updatedAt: '2026-03-10', fetchedAt: 0, coverage: 'partial' },
        },
    })
    expect(screen.getByText(/1 undated price/)).toBeInTheDocument()
})

test('applies the same unit policy to the gainers tab', () => {
    renderWidget()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Gainers' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Gainers' }))

    const gainerRow = screen.getByTestId('rs-price-THD')
    expect(gainerRow).toHaveTextContent('n/a')
    expect(gainerRow).not.toHaveTextContent('113.5')
})

test('describeRSPrice never emits a number without a certified unit', () => {
    expect(describeRSPrice({ price: 10000, price_unit: 'VND', price_asof: '2026-03-09' })).toEqual({
        text: '10,000',
        unitLabel: 'VND',
        title: 'Stored price as of 2026-03-09 in VND.',
    })
    expect(describeRSPrice({ price: 1200.25, price_unit: 'index_points' }).unitLabel).toBe('pts')
    expect(describeRSPrice({ price: 113.5, price_unit: 'unknown' }).text).toBe('n/a')
    expect(describeRSPrice({ price: 113.5, price_unit: null }).text).toBe('n/a')
    expect(describeRSPrice({ price: 113.5 }).text).toBe('n/a')
    expect(describeRSPrice({ price: 0, price_unit: 'VND' }).text).toBe('n/a')
    expect(describeRSPrice({ price: -5, price_unit: 'VND' }).text).toBe('n/a')
    expect(describeRSPrice({ price: Number.NaN, price_unit: 'VND' }).text).toBe('n/a')
    expect(describeRSPrice({ price: null, price_unit: 'VND' }).text).toBe('n/a')
    // An undated stored price says so; it never borrows the ranking date.
    expect(describeRSPrice({ price: 1000, price_unit: 'VND', price_asof: null })).toEqual({
        text: '1,000',
        unitLabel: 'VND',
        title: 'Stored price, observation date unknown in VND.',
    })
})
