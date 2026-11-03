import { fireEvent, render, screen, within } from '@testing-library/react';
import { PortfolioTrackerWidget } from './PortfolioTrackerWidget';
import { exportToCSV, exportToJSON } from '@/lib/exportWidget';

jest.mock('@tanstack/react-query', () => ({ useQueries: () => [] }));
const mockPortfolioPrices = jest.fn(() => ({ prices: new Map(), isLoading: false, refetch: jest.fn() }));
jest.mock('@/lib/hooks/usePortfolioPrices', () => ({ usePortfolioPrices: () => mockPortfolioPrices() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }));
jest.mock('@/lib/exportWidget', () => ({ exportToCSV: jest.fn(), exportToJSON: jest.fn() }));

const KEY = 'vnibb_portfolio_v2';

function addPosition(quantity: string) {
    if (!screen.queryByPlaceholderText('Symbol')) fireEvent.click(screen.getByTitle('Add position'));
    fireEvent.change(screen.getByPlaceholderText('Symbol'), { target: { value: 'FPT' } });
    fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: quantity } });
    fireEvent.change(screen.getByPlaceholderText('Avg Cost'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Add'));
}

describe('Holdings Tracker saved positions', () => {
    beforeEach(() => {
        window.localStorage.clear();
        jest.clearAllMocks();
        // Default: no quotes. Each test that needs prices sets its own map.
        mockPortfolioPrices.mockReturnValue({ prices: new Map(), isLoading: false, isError: false, refetch: jest.fn() } as never);
    });
    afterEach(() => jest.restoreAllMocks());

    it('refuses fractional or nonpositive shares without truncating', () => {
        render(<PortfolioTrackerWidget />);
        addPosition('2.5');
        expect(screen.getByText('Add')).toBeDisabled();
        expect(screen.getByText('Add holdings to track')).toBeInTheDocument();
        for (const quantity of ['0', '-2']) {
            fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: quantity } });
            expect(screen.getByText('Add')).toBeDisabled();
        }
        fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: '2' } });
        fireEvent.click(screen.getByText('Add'));
        fireEvent.click(screen.getByTitle('Edit'));
        const row = screen.getByRole('row', { name: /FPT/ });
        fireEvent.change(within(row).getAllByRole('spinbutton')[0], { target: { value: '3.5' } });
        expect(within(row).getAllByRole('button')[0]).toBeDisabled();
        expect(JSON.parse(window.localStorage.getItem(KEY)!).positions[0].quantity).toBe(2);
    });
    it('retains saved holdings and exports only committed rows after storage fails', () => {
        render(<PortfolioTrackerWidget />);
        addPosition('2');
        const committed = window.localStorage.getItem(KEY);
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
        addPosition('3');
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save holdings');
        expect(screen.getByPlaceholderText('Symbol')).toHaveValue('FPT');
        expect(window.localStorage.getItem(KEY)).toBe(committed);
        fireEvent.click(screen.getByRole('button', { name: 'Export portfolio to JSON' }));
        const payload = jest.mocked(exportToJSON).mock.calls[0][0] as { portfolio: { positions: { quantity: number }[] }; positions: { quantity: number }[] };
        expect(payload.portfolio.positions.map(p => p.quantity)).toEqual([2]);
        expect(payload.positions.map(p => p.quantity)).toEqual([2]);
        fireEvent.click(screen.getByTitle('Export to CSV'));
        expect((jest.mocked(exportToCSV).mock.calls[0][0] as { section: string; quantity?: number }[]).filter(row => row.section === 'position').map(row => row.quantity)).toEqual([2]);
    });
    // Brand §19: a measured flat session is `0.0%` with no direction glyph and
    // no gain/loss hue. It previously rendered as an up arrow in gain green,
    // which reads as a positive move that never happened.
    it('renders a flat session with no arrow and no direction colour', () => {
        mockPortfolioPrices.mockReturnValue({
            prices: new Map([['FPT', {
                symbol: 'FPT', currentPrice: 1000, change: 0, changePct: 0,
                updatedAt: '2026-11-03T00:00:00Z', fetchedAt: 1793664000000, isLoading: false, error: null,
            }]]),
            isLoading: false,
            isError: false,
            refetch: jest.fn(),
        } as never);
        render(<PortfolioTrackerWidget />);
        addPosition('2');

        const row = screen.getByRole('row', { name: /FPT/ });
        // Day change and P/L both print `0.0%` here, so key the assertion off the
        // absent glyph and the muted ink rather than a single text node.
        expect(within(row).queryByText(/↑|↓/)).not.toBeInTheDocument();
        expect(within(row).getAllByText('0.0%').length).toBeGreaterThan(0);
        // Direction ink lives on the cell wrappers, so check the whole row.
        expect(row.querySelector('.text-\\[var\\(--color-positive\\)\\]')).toBeNull();
        expect(row.querySelector('.text-\\[var\\(--color-negative\\)\\]')).toBeNull();
    });

    // 0.04% is a real move, but it renders as `0.0%`: showing an up arrow over
    // unsigned digits would claim precision the display does not have.
    it('drops the arrow when a real move rounds to 0.0%', () => {
        mockPortfolioPrices.mockReturnValue({
            prices: new Map([['FPT', {
                symbol: 'FPT', currentPrice: 1000, change: 2, changePct: 0.04,
                updatedAt: '2026-11-03T00:00:00Z', fetchedAt: 1793664000000, isLoading: false, error: null,
            }]]),
            isLoading: false,
            isError: false,
            refetch: jest.fn(),
        } as never);
        render(<PortfolioTrackerWidget />);
        addPosition('2');

        const row = screen.getByRole('row', { name: /FPT/ });
        expect(within(row).getAllByText('0.0%').length).toBeGreaterThan(0);
        expect(within(row).queryByText(/↑|↓/)).not.toBeInTheDocument();
    });

    // Regression: the old path divided an already-percent P/L by 100 and fed it
    // to an `|v| <= 1 means ratio` heuristic, so a 150% gain printed +1.5%.
    it('renders a P/L above 100% at its true magnitude', () => {
        mockPortfolioPrices.mockReturnValue({
            prices: new Map([['FPT', {
                symbol: 'FPT', currentPrice: 2500, change: 0, changePct: 0,
                updatedAt: '2026-11-03T00:00:00Z', fetchedAt: 1793664000000, isLoading: false, error: null,
            }]]),
            isLoading: false,
            isError: false,
            refetch: jest.fn(),
        } as never);
        render(<PortfolioTrackerWidget />);
        addPosition('2');

        const row = screen.getByRole('row', { name: /FPT/ });
        expect(within(row).getByText('+150.0%')).toBeInTheDocument();
        expect(within(row).queryByText('+1.5%')).not.toBeInTheDocument();
    });

    it('omits nonfinite day changes instead of showing NaN', () => {
        mockPortfolioPrices.mockReturnValue({
            prices: new Map([['FPT', {
                symbol: 'FPT', currentPrice: 1000, change: null, changePct: Number.NaN,
                updatedAt: '2026-11-03T00:00:00Z', fetchedAt: 1793664000000, isLoading: false, error: null,
            }]]),
            isLoading: false,
            isError: false,
            refetch: jest.fn(),
        } as never);
        render(<PortfolioTrackerWidget />);
        addPosition('2');
        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
        expect(screen.queryByText(/↑|↓/)).not.toBeInTheDocument();
    });


    it('keeps an unsaved edit open so it can be retried after storage recovers', () => {
        render(<PortfolioTrackerWidget />);
        addPosition('2');
        fireEvent.click(screen.getByTitle('Edit'));
        const row = screen.getByRole('row', { name: /FPT/ });
        fireEvent.change(within(row).getAllByRole('spinbutton')[0], { target: { value: '4' } });
        const failure = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
        fireEvent.click(within(row).getAllByRole('button')[0]);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save holdings');
        expect(within(row).getAllByRole('spinbutton')[0]).toHaveValue(4);
        expect(JSON.parse(window.localStorage.getItem(KEY)!).positions[0].quantity).toBe(2);
        failure.mockRestore();
        fireEvent.click(within(row).getAllByRole('button')[0]);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem(KEY)!).positions[0].quantity).toBe(4);
    });
});
