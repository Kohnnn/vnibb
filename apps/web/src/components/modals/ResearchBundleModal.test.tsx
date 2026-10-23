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

it('prunes disappeared thesis keys, frees the 50-item cap, and downloads only surviving selections', async () => {
    const symbols = Array.from({ length: 51 }, (_, index) => `A${String(index).padStart(2, '0')}`);
    const refresh = (available: string[], revision = 'Saved') => mockUseDashboard.mockReturnValue({
        state: {
            dashboards: [{
                id: 'personal', name: 'Personal', tabs: [{
                    id: 'research', name: 'Research', widgets: [{
                        id: 'notes', type: 'notes', config: {
                            notesBySymbol: Object.fromEntries(available.map((symbol) => [symbol, `${revision} ${symbol} notes`])),
                            thesesBySymbol: Object.fromEntries(available.map((symbol) => [symbol, { thesis: `${revision} ${symbol} thesis` }])),
                        },
                    }],
                }],
            }],
            folders: [], activeDashboardId: 'personal', activeTabId: 'research',
        },
        importResearchBundle: jest.fn(),
    } as unknown as DashboardContextValue);
    const createObjectURL = jest.fn((_blob: Blob) => 'blob:research-bundle');
    const revokeObjectURL = jest.fn();
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    refresh(symbols);

    try {
        const { rerender } = render(<ResearchBundleModal onClose={jest.fn()} />);
        const checkbox = (symbol: string) => screen.getByLabelText(`${symbol} · Personal / Research`);
        const download = screen.getByRole('button', { name: 'Download Research Bundle JSON' });
        for (const symbol of symbols.slice(0, 50)) await user.click(checkbox(symbol));
        expect(checkbox('A50')).toBeDisabled();

        refresh(symbols, 'Refreshed');
        rerender(<ResearchBundleModal onClose={jest.fn()} />);
        expect(screen.getAllByRole('checkbox').filter((input) => (input as HTMLInputElement).checked)).toHaveLength(50);

        refresh([...symbols.slice(1), 'B00'], 'Refreshed');
        rerender(<ResearchBundleModal onClose={jest.fn()} />);
        expect(checkbox('A01')).toBeChecked();
        expect(checkbox('A50')).toBeEnabled();
        expect(checkbox('B00')).toBeEnabled();
        await user.click(checkbox('B00'));
        expect(checkbox('A50')).toBeDisabled();

        refresh([...symbols, 'B00'], 'Refreshed');
        rerender(<ResearchBundleModal onClose={jest.fn()} />);
        expect(checkbox('A00')).not.toBeChecked();
        expect(checkbox('A00')).toBeDisabled();
        await user.click(download);
        expect(click).toHaveBeenCalledTimes(1);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        const blob = createObjectURL.mock.calls[0][0] as Blob;
        const raw = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
        const bundle = JSON.parse(raw);
        expect(blob.type).toBe('application/json');
        expect(bundle.theses.map(({ symbol }: { symbol: string }) => symbol)).toEqual([...symbols.slice(1, 50), 'B00']);
        expect(bundle.theses[0]).toEqual(expect.objectContaining({
            symbol: 'A01', note: 'Refreshed A01 notes', thesis: expect.objectContaining({ thesis: 'Refreshed A01 thesis' }),
        }));

        refresh(['A00', 'A50']);
        rerender(<ResearchBundleModal onClose={jest.fn()} />);
        expect(download).toBeDisabled();
        await user.click(download);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        refresh([...symbols, 'B00']);
        rerender(<ResearchBundleModal onClose={jest.fn()} />);
        expect(screen.getAllByRole('checkbox').every((input) => !(input as HTMLInputElement).checked)).toBe(true);
        expect(download).toBeDisabled();
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:research-bundle'), { timeout: 2000 });
    } finally {
        click.mockRestore();
        if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
        else Reflect.deleteProperty(URL, 'createObjectURL');
        if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
        else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
});
