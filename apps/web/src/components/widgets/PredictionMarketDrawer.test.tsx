import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { PredictionMarketDrawer } from './PredictionMarketDrawer';

function DrawerHarness() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open market</button>
            <PredictionMarketDrawer
                source="polymarket"
                sourceId="market-1"
                question="Will rates fall?"
                open={open}
                onClose={() => setOpen(false)}
            />
        </>
    );
}

describe('PredictionMarketDrawer', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    it('names the dialog and restores focus after Escape closes it', async () => {
        render(<DrawerHarness />);
        const opener = screen.getByRole('button', { name: 'Open market' });
        opener.focus();
        fireEvent.click(opener);

        const dialog = await screen.findByRole('dialog', { name: 'Will rates fall?' });
        fireEvent.keyDown(dialog, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(opener).toHaveFocus();
        });
    });

    it('measures only distinct observed timestamps and clears old history when switching windows', async () => {
        let completeOneDay: (response: Response) => void = () => undefined;
        const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
        global.fetch = jest.fn((input) => {
            if (String(input).includes('?search=')) return Promise.resolve(json({ data: [] }));
            if (String(input).includes('days=1')) return new Promise<Response>((resolve) => { completeOneDay = resolve; });
            return Promise.resolve(json({ points: [
                { captured_at: '2026-09-26T12:00:00Z', yes_price: 0.6 },
                { captured_at: '2026-09-26T10:00:00Z', yes_price: 0.4 },
                { captured_at: '2026-09-26T12:00:00Z', yes_price: 0.6 },
                { captured_at: 'invalid', yes_price: 0.9 },
                { captured_at: '2026-09-26T11:00:00Z', yes_price: 2 },
            ] }));
        });
        render(<PredictionMarketDrawer source="polymarket" sourceId="one" question="Observed market" open onClose={() => undefined} />);
        const section = screen.getByRole('region', { name: 'Observed probability history' });
        expect(await within(section).findByText('+20.0 pp')).toBeInTheDocument();
        expect(within(section).getByText('Distinct observations').nextElementSibling).toHaveTextContent('2');
        expect(within(section).getByText('Observed high').nextElementSibling).toHaveTextContent('60%');
        expect(within(section).getByText('Observed low').nextElementSibling).toHaveTextContent('40%');
        fireEvent.click(screen.getByRole('button', { name: '1d' }));
        expect(within(section).queryByText('+20.0 pp')).not.toBeInTheDocument();
        completeOneDay(json({ points: [{ captured_at: '2026-09-26T12:00:00Z', yes_price: 0.6 }] }));
        await waitFor(() => expect(within(section).getByText('Observed change').nextElementSibling).toHaveTextContent('—'));
        expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    });
});
