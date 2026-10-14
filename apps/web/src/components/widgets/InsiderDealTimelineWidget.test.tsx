import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { InsiderTrade } from '@/types/insider';
import { InsiderDealTimelineWidget } from './InsiderDealTimelineWidget';
import { useInsiderDeals } from '@/lib/queries';

jest.mock('@/lib/queries', () => ({
    useInsiderDeals: jest.fn(),
}));

jest.mock('@/lib/widgetRuntime', () => ({
    buildWidgetRuntime: jest.fn((payload: unknown) => payload),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
    WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
    WidgetMeta: () => null,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
    WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}));

jest.mock('@/components/ui/widget-states', () => ({
    WidgetError: ({ error }: { error: Error }) => <div data-testid="widget-error">{error.message}</div>,
    WidgetEmpty: ({ message }: { message: string }) => <div data-testid="widget-empty">{message}</div>,
}));

const mockDeals = useInsiderDeals as jest.MockedFunction<typeof useInsiderDeals>;

function deal(overrides: Partial<InsiderTrade>): InsiderTrade {
    return {
        id: 1,
        symbol: 'MSR',
        insider_name: 'Nguyen Van A',
        insider_position: 'CEO',
        deal_action: 'BUY',
        deal_quantity: 100,
        deal_price: 1_000,
        deal_value: 1_000,
        price_unit: 'VND',
        value_unit: 'VND',
        announce_date: '2026-01-05',
        ...overrides,
    };
}

function show(deals: InsiderTrade[]) {
    mockDeals.mockReturnValue({
        data: deals,
        isLoading: false,
        error: null,
        refetch: jest.fn(),
        isFetching: false,
        dataUpdatedAt: 0,
    } as unknown as UseQueryResult<InsiderTrade[], Error>);

    return render(<InsiderDealTimelineWidget id="timeline" symbol="MSR" />);
}

// The summary cards render label, count, and money in one block.
function card(label: string) {
    return screen.getByText(label).parentElement as HTMLElement
}

describe('InsiderDealTimelineWidget money aggregates', () => {
    afterEach(() => {
        mockDeals.mockReset();
    });

    it('withholds a side total when one classified row has no admitted VND value', () => {
        show([
            deal({ id: 1, deal_value: 1_000 }),
            deal({ id: 2, deal_value: 5_000, value_unit: 'unknown', price_unit: 'unknown' }),
        ]);

        expect(card('Buys')).toHaveTextContent('—');
        expect(card('Buys')).not.toHaveTextContent('VND');
    });

    it('sums a side once every classified row admits a finite VND value', () => {
        show([
            deal({ id: 1, deal_value: 1_000 }),
            deal({ id: 2, deal_value: 2_000 }),
        ]);

        expect(card('Buys')).toHaveTextContent('VND3,000');
    });

    it('keeps a side with no classified rows unavailable instead of zero', () => {
        show([deal({ id: 1, deal_action: 'Không xác định' })]);

        expect(card('Buys')).toHaveTextContent('—');
        expect(card('Sells')).toHaveTextContent('—');
    });
});
