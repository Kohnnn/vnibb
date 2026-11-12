import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { ResearchShareViewer } from './ResearchShareViewer';
import { readResearchShare, type ResearchShareRead } from '@/lib/researchSharing';

let mockUser: { id: string; provider: string } | null = { id: 'recipient', provider: 'supabase' };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('@/lib/researchSharing', () => ({ readResearchShare: jest.fn() }));

const share: ResearchShareRead = {
    share_id: 'share', owner_id: 'owner', recipient_ids: ['recipient'], created_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, thesis_count: 1, evidence_count: 1,
    bundle: { format: 'vnibb-thesis-evidence', version: 1, createdAt: '2026-01-01T00:00:00Z', theses: [{ symbol: 'FPT', thesis: { status: 'active', thesis: 'My frozen case', catalysts: 'Catalyst', risks: 'Risk', invalidation: 'Condition', reviewDate: '2026-12-31', notebookItemIds: ['nb:note'] } }], items: [{ id: 'nb:note', kind: 'note', title: 'Authored note', body: '<b>plain escaped text</b>', createdAt: '2026-01-01T00:00:00Z' }] },
};

beforeEach(() => {
    mockUser = { id: 'recipient', provider: 'supabase' };
    jest.mocked(readResearchShare).mockReset();
});

it('renders frozen thesis and authored evidence as text without editing or import controls', async () => {
    jest.mocked(readResearchShare).mockResolvedValue(share);
    const { container } = render(<ResearchShareViewer shareId="share" />);
    expect(await screen.findByText('My frozen case')).toBeInTheDocument();
    expect(screen.getByText('<b>plain escaped text</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('input,textarea,select')).toBeNull();
    expect(screen.queryByRole('button', { name: /edit|import|save/i })).not.toBeInTheDocument();
});

it('requires sign-in and clears previously read data on sign-out', async () => {
    jest.mocked(readResearchShare).mockResolvedValue(share);
    const { rerender } = render(<ResearchShareViewer shareId="share" />);
    await screen.findByText('My frozen case');
    mockUser = null;
    rerender(<ResearchShareViewer shareId="share" />);
    expect(screen.queryByText('My frozen case')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in with the recipient/ })).toBeInTheDocument();
    expect(readResearchShare).toHaveBeenCalledTimes(1);
});

it('shows unavailable access instead of research after forbidden, revoked or expired API reads', async () => {
    jest.mocked(readResearchShare).mockRejectedValue(new Error('Research share not found'));
    render(<ResearchShareViewer shareId="share" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Access may have expired'));
    expect(screen.queryByText('My frozen case')).not.toBeInTheDocument();
});

describe('snapshot expiry', () => {
    const now = Date.parse('2026-11-13T00:00:00Z');

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(now);
    });
    afterEach(() => jest.useRealTimers());

    it('removes visible research at expiry without waiting for the authorization refresh', async () => {
        jest.mocked(readResearchShare).mockResolvedValue({ ...share, expires_at: new Date(now + 5000).toISOString() });
        await act(async () => { render(<ResearchShareViewer shareId="share" />); });
        expect(screen.getByText('My frozen case')).toBeInTheDocument();

        act(() => jest.advanceTimersByTime(5001));

        expect(screen.queryByText('My frozen case')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(/unavailable|expired/i);
        expect(readResearchShare).toHaveBeenCalledTimes(1);
    });

    it('keeps a long-lived snapshot visible without overflowing the timeout delay', async () => {
        jest.mocked(readResearchShare).mockResolvedValue(share);
        await act(async () => { render(<ResearchShareViewer shareId="share" />); });

        act(() => jest.advanceTimersByTime(1));

        expect(screen.getByText('My frozen case')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each(['2026-11-12T00:00:00Z', 'invalid-date'])('announces unavailable access for an expired or invalid response (%s)', async (expires_at) => {
        jest.mocked(readResearchShare).mockResolvedValue({ ...share, expires_at });
        await act(async () => { render(<ResearchShareViewer shareId="share" />); });

        expect(screen.queryByText('My frozen case')).not.toBeInTheDocument();
        expect(screen.queryByText('Loading authorized snapshot…')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(/unavailable|expired/i);
    });

    it.each(['share', 'identity'])('cleans up the old expiry timer on %s changes', async (change) => {
        jest.mocked(readResearchShare).mockResolvedValueOnce({ ...share, expires_at: new Date(now + 5000).toISOString() });
        let view: RenderResult;
        await act(async () => { view = render(<ResearchShareViewer shareId="share" />); });
        expect(screen.getByText('My frozen case')).toBeInTheDocument();
        const oldSignal = jest.mocked(readResearchShare).mock.calls[0][1];
        jest.mocked(readResearchShare).mockResolvedValue({ ...share, expires_at: new Date(now + 30000).toISOString(), bundle: { ...share.bundle, theses: [{ ...share.bundle.theses[0], thesis: { ...share.bundle.theses[0].thesis, thesis: 'New authorized case' } }] } });
        if (change === 'identity') mockUser = { id: 'other-recipient', provider: 'supabase' };
        await act(async () => { view!.rerender(<ResearchShareViewer shareId={change === 'share' ? 'new-share' : 'share'} />); });
        expect(oldSignal?.aborted).toBe(true);

        act(() => jest.advanceTimersByTime(5001));

        expect(screen.queryByText('My frozen case')).not.toBeInTheDocument();
        expect(screen.getByText('New authorized case')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        act(() => jest.advanceTimersByTime(25000));
        expect(screen.queryByText('New authorized case')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(/unavailable|expired/i);
    });
});
