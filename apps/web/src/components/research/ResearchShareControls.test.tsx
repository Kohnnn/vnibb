import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResearchShareControls } from './ResearchShareControls';
import { createResearchShare, listResearchShares, revokeResearchShare, type ResearchShareSummary } from '@/lib/researchSharing';
import type { ResearchBundle } from '@/lib/researchBundle';
import type { AuthUser } from '@/contexts/AuthContext';

let mockUser: AuthUser | null = null;
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('@/lib/researchSharing', () => ({ ...jest.requireActual('@/lib/researchSharing'), createResearchShare: jest.fn(), listResearchShares: jest.fn(), revokeResearchShare: jest.fn() }));
jest.mock('@/lib/api', () => ({ fetchAPI: jest.fn() }));

const bundle: ResearchBundle = { format: 'vnibb-thesis-evidence', version: 1, createdAt: '2026-01-01T00:00:00Z', theses: [{ symbol: 'FPT', thesis: { status: 'active', thesis: 'Case', catalysts: '', risks: '', invalidation: '', reviewDate: '' } }], items: [{ id: 'nb:provider', kind: 'news', title: 'Provider original', createdAt: '2026-01-01T00:00:00Z' }] };
const recipient = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const share = { share_id: 'share', owner_id: 'owner', recipient_ids: [recipient], created_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, thesis_count: 1, evidence_count: 0 };

function signInAs(id: string) {
    mockUser = { id, provider: 'supabase', email: null, user_metadata: {} };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
}

function previewAndCreate(recipientId: string) {
    fireEvent.change(screen.getByLabelText(/Recipient account UUIDs/), { target: { value: recipientId } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview author-only snapshot' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this snapshot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create recipient-only share' }));
}

beforeEach(() => {
    signInAs('owner');
    jest.mocked(listResearchShares).mockReset().mockResolvedValue([]);
    jest.mocked(createResearchShare).mockReset().mockResolvedValue(share);
    jest.mocked(revokeResearchShare).mockReset().mockResolvedValue({ revoked: true });
});

it('requires explicit reviewed author-only preview before creation and supports owner revocation', async () => {
    render(<ResearchShareControls buildBundle={() => bundle} />);
    await screen.findByText('No shares created.');
    fireEvent.change(screen.getByLabelText(/Recipient account UUIDs/), { target: { value: recipient } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview author-only snapshot' }));
    expect(screen.getByText(/Excluded: 1 provider/)).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create recipient-only share' });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this snapshot/ }));
    fireEvent.click(create);
    await screen.findByRole('link', { name: '/research-shares/share' });
    const submitted = jest.mocked(createResearchShare).mock.calls[0][0];
    expect(submitted.items).toEqual([]);
    expect(bundle.items).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(revokeResearchShare).toHaveBeenCalledWith('share'));
    expect(await screen.findByText(/Revoked/)).toBeInTheDocument();
});

it.each(['success', 'error'] as const)('discards stale create %s after switching accounts without clearing the new request', async (completion) => {
    const oldRequest = deferred<ResearchShareSummary>();
    const newRequest = deferred<ResearchShareSummary>();
    jest.mocked(createResearchShare).mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const { rerender } = render(<ResearchShareControls buildBundle={() => bundle} />);
    await waitFor(() => expect(listResearchShares).toHaveBeenCalledTimes(1));
    previewAndCreate(recipient);

    signInAs('second-owner');
    rerender(<ResearchShareControls buildBundle={() => bundle} />);
    await waitFor(() => expect(listResearchShares).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Preview author-only snapshot' })).toBeEnabled();
    const secondRecipient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    previewAndCreate(secondRecipient);

    await act(async () => {
        if (completion === 'success') oldRequest.resolve(share);
        else oldRequest.reject(new Error('Old account create failed.'));
    });
    expect(screen.queryByRole('link', { name: '/research-shares/share' })).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`Recipients: ${recipient}`))).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create recipient-only share' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /I reviewed this snapshot/ })).toBeChecked();

    await act(async () => { newRequest.resolve({ ...share, share_id: 'second-share', owner_id: 'second-owner', recipient_ids: [secondRecipient] }); });
    expect(screen.getByRole('link', { name: '/research-shares/second-share' })).toBeInTheDocument();
    expect(screen.getByText(`Recipients: ${secondRecipient}`)).toBeInTheDocument();
    expect(createResearchShare).toHaveBeenCalledTimes(2);
});

it.each(['success', 'error'] as const)('discards stale revoke %s after switching accounts without clearing the new request', async (completion) => {
    const oldRequest = deferred<{ revoked: boolean }>();
    const newRequest = deferred<{ revoked: boolean }>();
    const secondShare = { ...share, share_id: 'second-share', owner_id: 'second-owner', recipient_ids: ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'] };
    jest.mocked(listResearchShares).mockResolvedValueOnce([share]).mockResolvedValueOnce([secondShare]);
    jest.mocked(revokeResearchShare).mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const { rerender } = render(<ResearchShareControls buildBundle={() => bundle} />);
    await screen.findByRole('link', { name: '/research-shares/share' });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));

    signInAs('second-owner');
    rerender(<ResearchShareControls buildBundle={() => bundle} />);
    await screen.findByRole('link', { name: '/research-shares/second-share' });
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));

    await act(async () => {
        if (completion === 'success') oldRequest.resolve({ revoked: true });
        else oldRequest.reject(new Error('Old account revoke failed.'));
    });
    expect(screen.queryByRole('link', { name: '/research-shares/share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Revoked/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeDisabled();

    await act(async () => { newRequest.resolve({ revoked: true }); });
    expect(screen.getByText(/Revoked/)).toBeInTheDocument();
    expect(revokeResearchShare).toHaveBeenCalledTimes(2);
});

it.each([
    ['create', 'success'],
    ['create', 'error'],
    ['revoke', 'success'],
    ['revoke', 'error'],
] as const)('discards %s %s after unmount without retries', async (operation, completion) => {
    const createRequest = deferred<ResearchShareSummary>();
    const revokeRequest = deferred<{ revoked: boolean }>();
    jest.mocked(createResearchShare).mockReturnValueOnce(createRequest.promise);
    jest.mocked(revokeResearchShare).mockReturnValueOnce(revokeRequest.promise);
    jest.mocked(listResearchShares).mockResolvedValueOnce(operation === 'revoke' ? [share] : []);
    const { unmount } = render(<ResearchShareControls buildBundle={() => bundle} />);
    if (operation === 'create') {
        await waitFor(() => expect(listResearchShares).toHaveBeenCalledTimes(1));
        previewAndCreate(recipient);
    } else {
        await screen.findByRole('link', { name: '/research-shares/share' });
        fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    }
    unmount();

    signInAs('second-owner');
    render(<ResearchShareControls buildBundle={() => bundle} />);
    await waitFor(() => expect(listResearchShares).toHaveBeenCalledTimes(2));
    await act(async () => {
        if (operation === 'create') {
            if (completion === 'success') createRequest.resolve(share);
            else createRequest.reject(new Error('Unmounted create failed.'));
        } else {
            if (completion === 'success') revokeRequest.resolve({ revoked: true });
            else revokeRequest.reject(new Error('Unmounted revoke failed.'));
        }
    });

    expect(screen.queryByRole('link', { name: '/research-shares/share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview author-only snapshot' })).toBeEnabled();
    expect(createResearchShare).toHaveBeenCalledTimes(operation === 'create' ? 1 : 0);
    expect(revokeResearchShare).toHaveBeenCalledTimes(operation === 'revoke' ? 1 : 0);
});
