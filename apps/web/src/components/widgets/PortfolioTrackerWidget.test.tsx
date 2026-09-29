import { fireEvent, render, screen, within } from '@testing-library/react';
import { PortfolioTrackerWidget } from './PortfolioTrackerWidget';
import { exportToCSV, exportToJSON } from '@/lib/exportWidget';

jest.mock('@tanstack/react-query', () => ({ useQueries: () => [] }));
jest.mock('@/lib/hooks/usePortfolioPrices', () => ({ usePortfolioPrices: () => ({ prices: new Map(), isLoading: false, refetch: jest.fn() }) }));
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
