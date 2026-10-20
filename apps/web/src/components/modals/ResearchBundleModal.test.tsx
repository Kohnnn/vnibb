import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDashboard, type DashboardContextValue } from '@/contexts/DashboardContext';
import { ResearchBundleModal } from './ResearchBundleModal';

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));

const mockUseDashboard = jest.mocked(useDashboard);

function ResearchTransferLauncher() {
    const [open, setOpen] = useState(false);
    return <>
        <button type="button" onClick={() => setOpen(true)}>Transfer research</button>
        {open && <ResearchBundleModal onClose={() => setOpen(false)} />}
    </>;
}

it('moves focus into research transfer, contains Tab navigation, and restores its opener after Escape', async () => {
    const visibleElements = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
    const context: Partial<DashboardContextValue> = {
        state: { dashboards: [], folders: [], activeDashboardId: null, activeTabId: null },
        importResearchBundle: jest.fn(),
    };
    mockUseDashboard.mockReturnValue(context as DashboardContextValue);
    const user = userEvent.setup();

    try {
        render(<ResearchTransferLauncher />);
        const opener = screen.getByRole('button', { name: 'Transfer research' });
        await user.click(opener);
        const dialog = screen.getByRole('dialog', { name: 'Transfer Thesis & Evidence' });
        const close = screen.getByRole('button', { name: 'Close research transfer' });
        const lastControl = screen.getByRole('link', { name: 'Sign in with your account to manage shares.' });

        await waitFor(() => expect(close).toHaveFocus());
        await user.tab({ shift: true });
        expect(lastControl).toHaveFocus();
        await user.tab();
        expect(close).toHaveFocus();
        await user.tab();
        expect(screen.getByLabelText('Import research bundle JSON (up to 5 MB)')).toHaveFocus();
        await user.tab();
        expect(lastControl).toHaveFocus();
        await user.keyboard('{Escape}');

        expect(dialog).not.toBeInTheDocument();
        await waitFor(() => expect(opener).toHaveFocus());
    } finally {
        visibleElements.mockRestore();
    }
});
