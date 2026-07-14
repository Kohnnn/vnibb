import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
