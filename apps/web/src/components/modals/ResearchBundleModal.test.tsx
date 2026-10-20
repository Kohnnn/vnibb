import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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

it.each(['resolve', 'reject'] as const)('imports only the latest research bundle when an obsolete read later %ss', async (settlement) => {
    const importResearchBundle = jest.fn();
    mockUseDashboard.mockReturnValue({
        state: { dashboards: [], folders: [], activeDashboardId: null, activeTabId: null },
        importResearchBundle,
    } as unknown as DashboardContextValue);
    const bundle = (symbol: string, thesis: string) => JSON.stringify({
        format: 'vnibb-thesis-evidence', version: 1, createdAt: '2026-10-20T00:00:00.000Z',
        theses: [{ symbol, thesis: { status: 'active', thesis, catalysts: 'Capacity', risks: 'Execution', invalidation: 'Margins', reviewDate: '2026-12-31' } }],
        items: [],
    });
    let resolveOld!: (value: string) => void;
    let rejectOld!: (reason: Error) => void;
    const oldRead = new Promise<string>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    let resolveLatest!: (value: string) => void;
    const latestRead = new Promise<string>((resolve) => { resolveLatest = resolve; });
    const readyFile = Object.assign(new File(['ready'], 'ready.json', { type: 'application/json' }), {
        text: () => Promise.resolve(bundle('VCB', 'Previously previewed research')),
    });
    const oldFile = Object.assign(new File(['old'], 'old.json', { type: 'application/json' }), { text: () => oldRead });
    const latestFile = Object.assign(new File(['latest'], 'latest.json', { type: 'application/json' }), { text: () => latestRead });
    const user = userEvent.setup();
    render(<ResearchBundleModal onClose={jest.fn()} />);
    const input = screen.getByLabelText('Import research bundle JSON (up to 5 MB)');
    const importButton = { name: 'Import Into New Research Dashboard' };

    await user.upload(input, readyFile);
    expect(await screen.findByRole('button', importButton)).toBeInTheDocument();
    await user.upload(input, oldFile);
    expect(screen.queryByRole('button', importButton)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready to import/)).not.toBeInTheDocument();
    await user.upload(input, latestFile);
    expect(screen.queryByRole('button', importButton)).not.toBeInTheDocument();
    await act(async () => { resolveLatest(bundle('FPT', 'Latest research')); });
    expect(screen.getByRole('button', importButton)).toBeInTheDocument();

    await act(async () => {
        if (settlement === 'resolve') resolveOld(bundle('VNM', 'Obsolete research'));
        else rejectOld(new Error('Obsolete file could not be read.'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', importButton));

    expect(importResearchBundle).toHaveBeenCalledTimes(1);
    expect(importResearchBundle).toHaveBeenCalledWith(expect.objectContaining({
        theses: [expect.objectContaining({ symbol: 'FPT', thesis: expect.objectContaining({ thesis: 'Latest research' }) })],
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Imported 1 theses');
});
