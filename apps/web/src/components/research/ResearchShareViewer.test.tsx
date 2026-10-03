import { render, screen, waitFor } from '@testing-library/react';
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
