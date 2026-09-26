import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDashboard, type DashboardContextValue } from '@/contexts/DashboardContext';
import { WorkspaceBackupModal } from './WorkspaceBackupModal';
import { createWorkspaceBackup } from '@/lib/workspaceBackup';

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ getSharedGroups: jest.fn() }) }));
const mockUseDashboard = jest.mocked(useDashboard);
const backup = createWorkspaceBackup({
    folders: [], activeDashboardId: null, activeTabId: null,
    dashboards: [{ id: 'personal', name: 'My research', order: 0, isDefault: false, showGroupLabels: true,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', syncGroups: [], tabs: [{ id: 'tab', name: 'Thesis', order: 0, widgets: [] }],
    }],
});

function chooseFile(text: string) {
    const file = new File([text], 'workspace.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
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
