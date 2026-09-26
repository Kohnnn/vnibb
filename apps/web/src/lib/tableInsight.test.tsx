import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { ChartableColumn, TableSelection } from '@/lib/tableInsight';
import {
    buildTableInsightContext,
    describeSelection,
    selectableSeries,
    seriesFromSelection,
    toggleSelection,
} from '@/lib/tableInsight';

// ---------------------------------------------------------------------------
// Contract behaviour
// ---------------------------------------------------------------------------

const columns: ChartableColumn[] = [
    { key: 'revenue', label: 'Revenue', kind: 'currency' },
    { key: 'netMargin', label: 'Net Margin %', kind: 'percent' },
    { key: 'note', label: 'Note', kind: 'text' },
    { key: '2024', label: '2024', kind: 'number', isPeriod: true },
    { key: '2025', label: '2025', kind: 'number', isPeriod: true },
];

describe('selectableSeries', () => {
    it('excludes period columns and text columns, defaulting the rest to number', () => {
        expect(selectableSeries(columns)).toEqual([
            { key: 'revenue', label: 'Revenue', kind: 'currency' },
            { key: 'netMargin', label: 'Net Margin %', kind: 'percent' },
        ]);
    });

    it('treats a kind-less column as a numeric series', () => {
        expect(selectableSeries([{ key: 'eps', label: 'EPS' }])).toEqual([
            { key: 'eps', label: 'EPS', kind: 'number' },
        ]);
    });
});

describe('toggleSelection', () => {
    it('selects nothing to start with, then the clicked target', () => {
        expect(toggleSelection(null, { kind: 'column', key: 'revenue' })).toEqual({ kind: 'column', key: 'revenue' });
    });

    it('clears when the same target is clicked twice', () => {
        const first = toggleSelection(null, { kind: 'row', key: '2025' });
        expect(toggleSelection(first, { kind: 'row', key: '2025' })).toBeNull();
    });

    it('replaces a row selection with a different row, and with a column of the same key', () => {
        const row2024: TableSelection = { kind: 'row', key: '2024' };
        expect(toggleSelection(row2024, { kind: 'row', key: '2025' })).toEqual({ kind: 'row', key: '2025' });
        expect(toggleSelection(row2024, { kind: 'column', key: '2024' })).toEqual({ kind: 'column', key: '2024' });
    });
});

describe('seriesFromSelection', () => {
    it('returns every numeric series when nothing is selected', () => {
        expect(seriesFromSelection(columns, null).map((entry) => entry.key)).toEqual(['revenue', 'netMargin']);
    });

    it('returns exactly the selected series for a metric selection', () => {
        expect(seriesFromSelection(columns, { kind: 'column', key: 'netMargin' })).toEqual([
            { key: 'netMargin', label: 'Net Margin %', kind: 'percent' },
        ]);
    });

    it('returns every numeric series for a period row, never the period itself', () => {
        const series = seriesFromSelection(columns, { kind: 'row', key: '2024' });
        expect(series.map((entry) => entry.key)).toEqual(['revenue', 'netMargin']);
        expect(series.some((entry) => entry.key === '2024')).toBe(false);
    });

    it('returns an empty list when a period is wrongly selected as a column', () => {
        expect(seriesFromSelection(columns, { kind: 'column', key: '2024' })).toEqual([]);
    });
});

describe('describeSelection', () => {
    it('labels no selection, a metric column, and a period row', () => {
        expect(describeSelection(null, columns)).toBe('All metrics');
        expect(describeSelection({ kind: 'column', key: 'revenue' }, columns)).toBe('Revenue');
        expect(describeSelection({ kind: 'row', key: '2024' }, columns, '2024')).toBe('Period 2024');
    });

    it('falls back to the raw key when the column is unknown', () => {
        expect(describeSelection({ kind: 'column', key: 'missing' }, columns)).toBe('missing');
    });
});

describe('buildTableInsightContext', () => {
    it('reports focus and the charted series, with neither key set when unselected', () => {
        expect(buildTableInsightContext({ selection: null, columns })).toEqual({
            focus: 'All metrics',
            series: seriesFromSelection(columns, null),
            rowKey: null,
            columnKey: null,
        });
    });

    it('sets columnKey for a metric selection and rowKey for a period selection', () => {
        const metric = buildTableInsightContext({ selection: { kind: 'column', key: 'revenue' }, columns });
        expect(metric.columnKey).toBe('revenue');
        expect(metric.rowKey).toBeNull();
        expect(metric.series.map((entry) => entry.key)).toEqual(['revenue']);

        const period = buildTableInsightContext({ selection: { kind: 'row', key: '2025' }, columns, rowLabel: '2025' });
        expect(period.rowKey).toBe('2025');
        expect(period.columnKey).toBeNull();
        expect(period.focus).toBe('Period 2025');
    });
});

// ---------------------------------------------------------------------------
// Component interaction: a click must change what the chart renders
// ---------------------------------------------------------------------------

jest.mock('recharts', () => ({
    Area: ({ dataKey }: { readonly dataKey?: string }) => <span data-testid={`area-${dataKey}`} />,
    Bar: ({ dataKey }: { readonly dataKey?: string }) => <span data-testid={`bar-${dataKey}`} />,
    CartesianGrid: () => null,
    ComposedChart: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
    Legend: () => null,
    Line: ({ dataKey }: { readonly dataKey?: string }) => <span data-testid={`line-${dataKey}`} />,
    ReferenceLine: () => null,
    ResponsiveContainer: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
}));

jest.mock('@/lib/queries', () => ({
    useIncomeStatement: jest.fn(),
    useCashFlow: jest.fn(),
}));

jest.mock('@/hooks/useLoadingTimeout', () => ({
    useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}));

// Mirror the real builder: `extra` is spread at the payload's top level, so a
// mocked passthrough would hide fields like `periods` from consumer assertions.
jest.mock('@/lib/widgetRuntime', () => ({
    buildWidgetRuntime: ({ extra, ...rest }: { extra?: Record<string, unknown> } & Record<string, unknown>) => ({
        __widgetRuntime: {
            layoutHint: { empty: false },
            provenance: {
                sourceLabel: rest.sourceLabel,
                apiGroup: rest.apiGroup,
                endpoint: rest.endpoint,
                updatedAt: rest.lastDataDate,
                stale: rest.stale,
            },
        },
        ...(extra ?? {}),
    }),
}));

jest.mock('@/components/ui/ChartMountGuard', () => ({
    ChartMountGuard: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
    WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}));

jest.mock('@/components/ui/widget-states', () => ({
    WidgetEmpty: ({ message }: { readonly message: string }) => <div>{message}</div>,
    WidgetError: ({ error }: { readonly error: Error }) => <div>{error.message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
    WidgetMeta: () => <div data-testid="widget-meta" />,
}));

jest.mock('@/components/ui/PeriodToggle', () => ({
    PeriodToggle: () => null,
}));

jest.mock('@/hooks/usePeriodState', () => ({
    usePeriodState: () => ({ period: 'FY', setPeriod: jest.fn() }),
}));

jest.mock('@/contexts/UnitContext', () => ({
    useUnit: () => ({ config: { unit: 'raw', currency: 'VND' } }),
}));

// Render the real header actions (the table/chart view toggle lives there); the
// header itself is stubbed because it pulls export/provenance machinery.
jest.mock('@/components/ui/WidgetHeader', () => ({
    WidgetHeader: ({ actions }: { readonly actions?: ReactNode }) => <div>{actions}</div>,
}));

jest.mock('@/components/widgets/charts/CashFlowWaterfallChart', () => ({
    CashFlowWaterfallChart: () => <div data-testid="cash-flow-waterfall" />,
}));
jest.mock('@/components/widgets/charts/IncomeSankeyChart', () => ({
    IncomeSankeyChart: () => <div data-testid="income-sankey" />,
}));


import { useCashFlow, useIncomeStatement } from '@/lib/queries';
import { CashFlowWidget } from '@/components/widgets/CashFlowWidget';
import { IncomeStatementWidget } from '@/components/widgets/IncomeStatementWidget';

const mockUseIncomeStatement = jest.mocked(useIncomeStatement);
const mockUseCashFlow = jest.mocked(useCashFlow);

const incomeRow = {
    symbol: 'FPT',
    period: '2025FY',
    revenue: 1000,
    gross_profit: 400,
    operating_income: 300,
    net_income: 250,
    eps: 5000,
    eps_diluted: 4800,
};

const cashFlowRow = {
    symbol: 'FPT',
    period: '2025FY',
    operating_cash_flow: 800,
    investing_cash_flow: -300,
    financing_cash_flow: -200,
    free_cash_flow: 500,
    net_change_in_cash: 300,
    capex: -120,
};

function queryResult<TData>(data: TData) {
    return {
        data,
        isLoading: false,
        error: null,
        refetch: jest.fn(),
        isFetching: false,
        dataUpdatedAt: 1,
    } as unknown as ReturnType<typeof useIncomeStatement>;
}

function chartControl(name: string): HTMLElement {
    return screen.getByRole('button', { name });
}

describe('IncomeStatementWidget table selection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseIncomeStatement.mockReturnValue(
            queryResult({ symbol: 'FPT', count: 1, data: [incomeRow] }) as never,
        );
        mockUseCashFlow.mockReturnValue(
            queryResult(null) as never,
        );
    });


    // The rows only exist in the table view, so every test selects there first
    // and then switches to the chart - which is also how a user drives it.
    function openChart() {
        fireEvent.click(screen.getByTitle('Chart View'));
    }

    function openTable() {
        fireEvent.click(screen.getByTitle('Table View'));
    }

    it('charts the default revenue series and labels it before any selection', () => {
        render(<IncomeStatementWidget id="income-1" symbol="FPT" />);
        openChart();
        expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
        expect(screen.getByTestId('line-netIncome')).toBeInTheDocument();
        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('All metrics');
    });

    it('charts only the selected metric, then restores the previous chart when cleared', () => {
        render(<IncomeStatementWidget id="income-1" symbol="FPT" />);
        fireEvent.click(screen.getByRole('button', { name: 'Chart Net Income' }));
        openChart();

        expect(screen.getByTestId('line-netIncome')).toBeInTheDocument();
        expect(screen.queryByTestId('bar-revenue')).toBeNull();
        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('Net Income');

        fireEvent.click(screen.getByRole('button', { name: 'Clear table selection' }));

        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('All metrics');
        expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
        expect(screen.getByTestId('line-netIncome')).toBeInTheDocument();
    });

    it('charts the second metric alone when a different row replaces the first', () => {
        render(<IncomeStatementWidget id="income-1" symbol="FPT" />);

        fireEvent.click(screen.getByRole('button', { name: 'Chart Revenue' }));
        openChart();
        expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
        expect(screen.queryByTestId('line-netIncome')).toBeNull();
        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('Revenue');

        // A different metric replaces the previous one.
        openTable();
        fireEvent.click(screen.getByRole('button', { name: 'Chart Gross Profit' }));
        openChart();

        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('Gross Profit');
        expect(screen.queryByTestId('bar-revenue')).toBeNull();
        expect(screen.queryByTestId('line-netIncome')).toBeNull();
    });

    it('restores the default chart when the selected metric row is clicked again', () => {
        render(<IncomeStatementWidget id="income-1" symbol="FPT" />);
        const control = screen.getByRole('button', { name: 'Chart Revenue' });
        fireEvent.click(control);
        openChart();
        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('Revenue');
        expect(screen.getByTestId('bar-revenue')).toBeInTheDocument();
        expect(screen.queryByTestId('line-netIncome')).toBeNull();

        openTable();
        fireEvent.click(screen.getByRole('button', { name: 'Chart Revenue' }));
        openChart();
        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('All metrics');
        expect(screen.getByTestId('line-netIncome')).toBeInTheDocument();
    });

    it('selects a metric from the keyboard and clears it with Escape', () => {
        render(<IncomeStatementWidget id="income-1" symbol="FPT" />);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Chart Operating Income' }), { key: 'Enter' });
        fireEvent.keyDown(screen.getByRole('listbox', { name: 'Financial statement rows' }), { key: 'Escape' });
        openChart();

        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('All metrics');
    });

    it('publishes the selection to the copilot through the existing payload without dropping other fields', () => {
        const onDataChange = jest.fn();
        render(<IncomeStatementWidget id="income-2" symbol="FPT" onDataChange={onDataChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Chart Net Income' }));

        // The widget publishes on mount and then again when the selection
        // changes; the last call carries the selection.
        const published = onDataChange.mock.calls.at(-1)?.[0] as {
            periods?: number;
            tableInsight?: { focus: string; series: { key: string }[]; rowKey: string | null; columnKey: string | null };
            __widgetRuntime?: { provenance?: { endpoint?: string } };
        };

        expect(published.periods).toBe(1);
        expect(published.__widgetRuntime?.provenance?.endpoint).toContain('/equity/FPT/income-statement');
        expect(published.tableInsight).toEqual({
            focus: 'Net Income',
            series: [{ key: 'netIncome', label: 'Net Income', kind: 'currency' }],
            rowKey: null,
            columnKey: 'netIncome',
        });
    });

    it('charts nothing for a period row, whose contract series are the table metrics', () => {
        render(<IncomeStatementWidget id="income-1" symbol="FPT" />);
        // Period columns are selected from the table header (the chart itself
        // has no period control here), which is the reported user flow.
        fireEvent.click(screen.getByTestId('dense-col-select-2025FY'));
        openChart();

        expect(screen.getByTestId('income-chart-focus')).toHaveTextContent('2025');
        expect(screen.queryByTestId('bar-revenue')).toBeNull();
        expect(screen.queryByTestId('line-netIncome')).toBeNull();
    });
});
describe('CashFlowWidget table selection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseCashFlow.mockReturnValue(
            queryResult({ symbol: 'FPT', count: 1, data: [cashFlowRow] }) as never,
        );
        mockUseIncomeStatement.mockReturnValue(queryResult(null) as never);
    });

    function openChart() {
        fireEvent.click(screen.getByTitle('Chart View'));
    }

    function openTable() {
        fireEvent.click(screen.getByTitle('Table View'));
    }

    it('charts the default cash-flow series and narrows to exactly one on selection', () => {
        render(<CashFlowWidget id="cash-1" symbol="FPT" />);
        // Rows only exist in the table view, so select there then chart it.
        fireEvent.click(screen.getByRole('button', { name: 'Chart Operating CF' }));
        openChart();

        expect(screen.getByTestId('cash-flow-chart-focus')).toHaveTextContent('Operating CF');
        expect(screen.getByTestId('bar-operatingCF')).toBeInTheDocument();
        expect(screen.queryByTestId('bar-investingCF')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear table selection' }));
        expect(screen.getByTestId('cash-flow-chart-focus')).toHaveTextContent('All metrics');
        expect(screen.getByTestId('bar-investingCF')).toBeInTheDocument();
    });

    it('replaces a previous metric selection with the newly clicked one', () => {
        render(<CashFlowWidget id="cash-1" symbol="FPT" />);

        fireEvent.click(screen.getByRole('button', { name: 'Chart Operating CF' }));
        openChart();
        expect(screen.getByTestId('cash-flow-chart-focus')).toHaveTextContent('Operating CF');
        expect(screen.getByTestId('bar-operatingCF')).toBeInTheDocument();
        expect(screen.queryByTestId('bar-investingCF')).toBeNull();

        // Rows live in the table view, so return there to pick the next metric.
        openTable();
        fireEvent.click(screen.getByRole('button', { name: 'Chart Free Cash Flow' }));
        openChart();
        expect(screen.getByTestId('cash-flow-chart-focus')).toHaveTextContent('Free Cash Flow');
        expect(screen.getByTestId('area-freeCashFlow')).toBeInTheDocument();
        expect(screen.queryByTestId('bar-operatingCF')).toBeNull();
    });
});
