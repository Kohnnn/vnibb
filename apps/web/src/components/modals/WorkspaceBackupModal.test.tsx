import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDashboard, type DashboardContextValue } from '@/contexts/DashboardContext';
import { WorkspaceBackupModal } from './WorkspaceBackupModal';
import { createWorkspaceBackup } from '@/lib/workspaceBackup';

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ getSharedGroups: jest.fn() }) }));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({
    useGlobalMarketsSymbol: () => ({ appGlobalMarketsSymbol: 'AMEX:SPY' }),
}));
const mockUseDashboard = jest.mocked(useDashboard);
const backup = createWorkspaceBackup({
    folders: [], activeDashboardId: null, activeTabId: null,
    dashboards: [{ id: 'personal', name: 'My research', order: 0, isDefault: false, showGroupLabels: true,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', syncGroups: [], tabs: [{ id: 'tab', name: 'Thesis', order: 0, widgets: [] }],
    }],
});

function chooseFile(text: string, read = () => Promise.resolve(text)) {
    const file = new File([text], 'workspace.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: read });
    fireEvent.change(screen.getByLabelText('Restore from a backup file (up to 5 MB)'), { target: { files: [file] } });
}

it('requires preview confirmation and keeps the preview on storage failure without claiming success', async () => {
    const restoreWorkspace = jest.fn(() => { throw new Error('Could not save imported workspaces in this browser. Nothing was imported.'); });
    const context: Partial<DashboardContextValue> = { restoreWorkspace, exportWorkspace: () => backup };
    mockUseDashboard.mockReturnValue(context as DashboardContextValue);
    render(<WorkspaceBackupModal isOpen onClose={jest.fn()} />);
    chooseFile(JSON.stringify(backup));
    await screen.findByText('Import preview');
    expect(screen.getByText('Dashboards: My research')).toBeInTheDocument();
    expect(restoreWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import as new workspaces' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Import preview')).toBeInTheDocument();
});

it('clears a previous valid preview after choosing malformed JSON', async () => {
    const restoreWorkspace = jest.fn();
    const context: Partial<DashboardContextValue> = { restoreWorkspace, exportWorkspace: () => backup };
    mockUseDashboard.mockReturnValue(context as DashboardContextValue);
    render(<WorkspaceBackupModal isOpen onClose={jest.fn()} />);
    chooseFile(JSON.stringify(backup));
    await screen.findByText('Import preview');
    chooseFile('{invalid');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not valid JSON'));
    expect(screen.queryByRole('button', { name: 'Import as new workspaces' })).not.toBeInTheDocument();
    expect(restoreWorkspace).not.toHaveBeenCalled();
});

function BackupSession() {
    const [isOpen, setIsOpen] = useState(true);
    return <>
        <button onClick={() => setIsOpen(true)}>Open backup</button>
        <WorkspaceBackupModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>;
}

it.each(['preview', 'error', 'status'])('starts without previous %s after closing and reopening a mounted consumer', async (state) => {
    const context: Partial<DashboardContextValue> = { restoreWorkspace: jest.fn(), exportWorkspace: () => backup };
    mockUseDashboard.mockReturnValue(context as DashboardContextValue);
    render(<BackupSession />);
    chooseFile(state === 'error' ? '{invalid' : JSON.stringify(backup));
    if (state === 'error') {
        await screen.findByRole('alert');
    } else {
        await screen.findByText('Import preview');
        if (state === 'status') {
            fireEvent.click(screen.getByRole('button', { name: 'Import as new workspaces' }));
            expect(screen.getByRole('status')).toHaveTextContent('Imported 1 dashboard');
        }
    }

    fireEvent.click(screen.getByRole('button', { name: 'Close backup dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open backup' }));

    expect(screen.queryByText('Import preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import as new workspaces' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Restore from a backup file (up to 5 MB)')).toBeEnabled();
});

it.each(['resolve', 'reject'])('ignores obsolete read %s and finally while a reopened session reads its own file', async (outcome) => {
    const context: Partial<DashboardContextValue> = { restoreWorkspace: jest.fn(), exportWorkspace: () => backup };
    mockUseDashboard.mockReturnValue(context as DashboardContextValue);
    let resolveOld!: (text: string) => void;
    let rejectOld!: (error: Error) => void;
    let resolveCurrent!: (text: string) => void;
    const oldRead = new Promise<string>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const currentRead = new Promise<string>((resolve) => { resolveCurrent = resolve; });
    render(<BackupSession />);
    chooseFile('', () => oldRead);
    expect(screen.getByLabelText('Restore from a backup file (up to 5 MB)')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Close backup dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open backup' }));
    const input = screen.getByLabelText('Restore from a backup file (up to 5 MB)');
    expect(input).toBeEnabled();
    chooseFile('', () => currentRead);
    await act(async () => {
        if (outcome === 'resolve') resolveOld(JSON.stringify(backup));
        else rejectOld(new Error('Obsolete read failed'));
    });

    expect(input).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Reading backup');
    expect(screen.queryByText('Import preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { resolveCurrent(JSON.stringify(backup)); });
    expect(screen.getByText('Import preview')).toBeInTheDocument();
    expect(input).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
