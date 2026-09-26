'use client';

import { useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDashboard } from '@/contexts/DashboardContext';
import { MAX_WORKSPACE_BACKUP_BYTES, parseWorkspaceBackup, previewWorkspaceBackup, WORKSPACE_BACKUP_EXCLUSIONS, type WorkspaceBackup } from '@/lib/workspaceBackup';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { X } from 'lucide-react';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';

interface WorkspaceBackupModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function WorkspaceBackupModal({ isOpen, onClose }: WorkspaceBackupModalProps) {
    const { exportWorkspace, restoreWorkspace } = useDashboard();
    const { getSharedGroups } = useWidgetGroups();
    const [backup, setBackup] = useState<WorkspaceBackup | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const dialogRef = useDialogFocusTrap<HTMLElement>({ enabled: isOpen, onClose });

    if (!isOpen) return null;

    const handleExport = () => {
        setError(null);
        setStatus(null);
        try {
            const data = exportWorkspace(getSharedGroups());
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            if (blob.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Workspace export exceeds the 5 MB limit.');
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `vnibb-workspace-${data.createdAt.slice(0, 10)}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setStatus(`Backup downloaded: ${data.dashboards.length} personal dashboard${data.dashboards.length === 1 ? '' : 's'}.`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not export workspace backup.');
        }
    };

    const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
        setBackup(null);
        setError(null);
        setStatus(null);
        const file = event.target.files?.[0];
        if (!file) return;
        setReading(true);
        try {
            if (file.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Workspace backup exceeds the 5 MB import limit.');
            setBackup(parseWorkspaceBackup(await file.text()));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not read workspace backup.');
        } finally {
            setReading(false);
            event.target.value = '';
        }
    };

    const handleRestore = () => {
        if (!backup) return;
        try {
            restoreWorkspace(backup);
            setStatus(`Imported ${backup.dashboards.length} dashboard${backup.dashboards.length === 1 ? '' : 's'} as new local workspaces.`);
            setBackup(null);
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Import failed. No workspaces were imported.');
        }
    };

    const preview = backup ? previewWorkspaceBackup(backup) : null;
    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-backup-title" className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-2xl text-[var(--text-primary)]">
                <div className="flex items-center justify-between gap-4">
                    <h2 id="workspace-backup-title" className="text-base font-semibold">Backup and restore workspaces</h2>
                    <button type="button" aria-label="Close backup dialog" onClick={onClose} className="rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><X size={16} /></button>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">Download your personal dashboards, tabs, widget configuration and positions, sync groups and folders as a JSON file. The file stays on your device unless you share it.</p>
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Excluded: {WORKSPACE_BACKUP_EXCLUSIONS}</p>
                <button type="button" onClick={handleExport} className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Download backup</button>
                <div className="mt-5 border-t border-[var(--border-color)] pt-4">
                    <label htmlFor="workspace-backup-file" className="block text-xs font-semibold">Restore from a backup file (up to 5 MB)</label>
                    <input id="workspace-backup-file" type="file" disabled={reading} accept=".json,application/json" onChange={handleFile} className="mt-2 block w-full text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--bg-tertiary)] file:px-3 file:py-2 file:text-[var(--text-primary)]" />
                    {reading && <p role="status" className="mt-2 text-xs">Reading backup…</p>}
                    {preview && <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-xs">
                        <h3 className="font-semibold">Import preview</h3>
                        <p className="mt-1">{preview.dashboards} dashboards · {preview.tabs} tabs · {preview.widgets} widgets · {preview.syncGroups} sync groups · {preview.folders} folders</p>
                        <p className="mt-2 break-words">Dashboards: {preview.dashboardNames.join(', ') || 'None'}</p>
                        <p className="mt-1 break-words">Folders: {preview.folderNames.join(', ') || 'None'}</p>
                        <p className="mt-2 text-[var(--text-muted)]">Excluded: {preview.exclusions}</p>
                        <p className="mt-2">Your existing dashboards and folders stay unchanged. New local-only copies get fresh IDs; nothing is sent to the backend.</p>
                        <button type="button" onClick={handleRestore} disabled={!preview.dashboards && !preview.folders} className="mt-3 rounded-md bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Import as new workspaces</button>
                    </div>}
                </div>
                {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
                {status && <p role="status" className="mt-3 text-xs text-emerald-400">{status}</p>}
            </section>
        </div>, document.body
    );
}
