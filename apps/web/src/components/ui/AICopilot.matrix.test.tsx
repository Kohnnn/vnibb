import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AICopilot } from './AICopilot';
import { consumeCopilotStream, openCopilotChatStream } from '@/lib/api';
import { MATRIX_FOLLOWUP_EVENT } from '@/lib/matrixHandoff';
import { archiveVniAgentSession } from '@/lib/vniagentSessions';
import { useAuth, type AuthUser } from '@/contexts/AuthContext';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('@/lib/queries', () => ({
    useProfile: () => ({ data: { data: { company: 'Live profile' } } }),
    useStockQuote: () => ({ data: { price: 999 } }),
    useFinancialRatios: () => ({ data: { data: { pe: 42 } } }),
}));
jest.mock('@/lib/api', () => ({
    openCopilotChatStream: jest.fn(),
    consumeCopilotStream: jest.fn(),
    getCopilotRuntimeConfig: jest.fn().mockResolvedValue({ provider: 'openrouter', model: 'test-model' }),
}));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/userPreferences', () => ({ dispatchOnboardingMeaningfulAction: jest.fn() }));
jest.mock('@/components/modals/PromptsLibrary', () => ({ PromptsLibrary: () => null }));
jest.mock('./CopilotArtifactPanel', () => ({ CopilotArtifactPanel: () => null }));
jest.mock('./CopilotActionPanel', () => ({ CopilotActionPanel: () => null }));
jest.mock('./CopilotEvidencePanel', () => ({ CopilotEvidencePanel: () => null }));
jest.mock('./CopilotFeedbackBar', () => ({ CopilotFeedbackBar: () => null }));

const selection = { snapshot_id: 'owned-snapshot', result_ids: ['FPT', 'VNM', 'HPG', 'MWG', 'SSI'].map((symbol) => `${symbol}-result`) };
const draft = { selection, request_text: 'Compare protected frozen observations for five companies' };
type StreamHandlers = NonNullable<Parameters<typeof consumeCopilotStream>[1]>;
const responseMeta = { responseId: 'matrix-response', provider: 'openrouter', model: 'test-model', mode: 'app_default', latencyMs: 25 };
const owner: AuthUser = { id: 'owner', email: null, user_metadata: {}, provider: 'supabase' };
const auth = {
    user: owner,
    session: null,
    loading: false,
    isConfigured: true,
    provider: 'supabase' as const,
    isAdmin: false,
    isGuest: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signInWithGoogle: jest.fn(),
    signInWithMagicLink: jest.fn(),
    signInAsAdmin: jest.fn(),
    signInAsGuest: jest.fn(),
    signOut: jest.fn(),
    canAdminLogin: false,
    canGuestLogin: false,
};

function stageDraft() {
    act(() => { window.dispatchEvent(new CustomEvent(MATRIX_FOLLOWUP_EVENT, { detail: draft })); });
}

function storedContent() {
    return [sessionStorage, localStorage].flatMap((storage) =>
        Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)!) || '')
    ).join('\n');
}

describe('Matrix Copilot handoff', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        jest.mocked(useAuth).mockReturnValue(auth);
        jest.mocked(openCopilotChatStream).mockResolvedValue({} as Response);
        jest.mocked(consumeCopilotStream).mockImplementation(async (_response, handlers) => {
            handlers?.onChunk?.('Protected frozen answer');
            handlers?.onDone?.({ done: true, responseMeta });
        });
    });

    test('stages an editable draft without sending, then sends all selected IDs without live context', async () => {
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" widgetContext="Financials" widgetContextData={{ secretLiveValue: 999 }} />);
        stageDraft();
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue(draft.request_text);
        expect(screen.getByRole('button', { name: 'Remove Matrix selection' })).toBeInTheDocument();
        expect(openCopilotChatStream).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Explain all five selected companies' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        expect(openCopilotChatStream).toHaveBeenCalledTimes(1);
        const request = jest.mocked(openCopilotChatStream).mock.calls[0][0];
        expect(request.matrix_selection).toEqual(selection);
        expect(request.message).toBe('Explain all five selected companies');
        expect(request.context).toBeUndefined();
        expect(request.history).toEqual([]);
        expect(request.settings?.webSearch).toBe(false);
        expect(storedContent()).not.toContain('Protected frozen answer');
        expect(screen.queryByRole('button', { name: 'Save to Research Notebook' })).not.toBeInTheDocument();
    });

    test('keeps follow-up answers private, then removes all Matrix content before normal chat resumes', async () => {
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        stageDraft();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Protected follow-up question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await waitFor(() => expect(screen.getAllByText('Protected frozen answer')).toHaveLength(2));
        expect(storedContent()).not.toMatch(/Protected|protected/);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Matrix selection' }));
        expect(screen.queryByText('Protected frozen answer')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('');
        jest.mocked(consumeCopilotStream).mockImplementation(async (_response, handlers) => { handlers?.onChunk?.('Normal answer'); });
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Normal question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Normal answer');
        const request = jest.mocked(openCopilotChatStream).mock.calls[2][0];
        expect(request.matrix_selection).toBeUndefined();
        expect(request.context?.symbol).toBe('VNM');
        expect(request.history).toEqual([]);
        expect(storedContent()).not.toMatch(/Protected|protected/);
        expect(storedContent()).toContain('Normal answer');
    });

    test('cancels a pending normal response when a Matrix draft arrives and ignores stale callbacks', async () => {
        let handlers: StreamHandlers | undefined;
        let finish: (() => void) | undefined;
        jest.mocked(consumeCopilotStream).mockImplementation((_response, nextHandlers) => {
            handlers = nextHandlers;
            return new Promise<void>((resolve) => { finish = resolve; });
        });
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Earlier live question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await waitFor(() => expect(handlers).toBeDefined());
        const signal = jest.mocked(openCopilotChatStream).mock.calls[0][1];
        stageDraft();
        expect(signal?.aborted).toBe(true);
        await act(async () => {
            handlers?.onChunk?.('Stale live response');
            handlers?.onDone?.({ done: true, responseMeta });
            finish?.();
        });
        expect(screen.queryByText('Stale live response')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue(draft.request_text);
        expect(openCopilotChatStream).toHaveBeenCalledTimes(1);
        expect(storedContent()).not.toContain('Stale live response');
    });

    test('New Chat does not archive protected content and clears the selection', async () => {
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        stageDraft();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
        expect(screen.queryByRole('button', { name: 'Remove Matrix selection' })).not.toBeInTheDocument();
        expect(screen.queryByText('Protected frozen answer')).not.toBeInTheDocument();
        expect(storedContent()).not.toMatch(/Protected|protected/);
    });

    test('restoring a normal session clears the private draft and resumes normal context', async () => {
        archiveVniAgentSession({ sessionKey: 'normal-session', symbol: 'VNM', messages: [{ id: 'old', role: 'user', content: 'Saved normal question', timestamp: new Date().toISOString() }] });
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        await screen.findByTitle('Active model: test-model');
        stageDraft();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        expect(screen.queryByRole('button', { name: 'Remove Matrix selection' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('');
        expect(storedContent()).not.toContain(draft.request_text);
    });

    test('access failures stay memory-only and never log backend error details', async () => {
        jest.mocked(openCopilotChatStream).mockRejectedValue(new Error('private-access-token-details'));
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        stageDraft();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText(/Your selection may no longer be accessible/);
        expect(screen.queryByText('private-access-token-details')).not.toBeInTheDocument();
        expect(storedContent()).not.toMatch(/private-access-token-details|protected frozen/);
    });

    test('revocation clears the attached draft without sending', async () => {
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        await screen.findByTitle('Active model: test-model');
        stageDraft();
        act(() => { window.dispatchEvent(new CustomEvent('vnibb:matrix-revoked', { detail: { snapshot_id: selection.snapshot_id } })); });
        expect(screen.queryByRole('button', { name: 'Remove Matrix selection' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('');
        expect(openCopilotChatStream).not.toHaveBeenCalled();
    });

    test('changing the signed-in owner clears protected conversation and export actions', async () => {
        const view = render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        stageDraft();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        expect(screen.queryByRole('button', { name: 'Export VniAgent chat' })).not.toBeInTheDocument();
        jest.mocked(useAuth).mockReturnValue({ ...auth, user: { ...owner, id: 'another-owner' } });
        view.rerender(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        expect(screen.queryByText('Protected frozen answer')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove Matrix selection' })).not.toBeInTheDocument();
        expect(storedContent()).not.toMatch(/Protected|protected/);
    });

    test('provider-export denial explains the policy and preserves the draft for retry', async () => {
        jest.mocked(openCopilotChatStream).mockRejectedValue(Object.assign(new Error('hidden details'), { status: 403 }));
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        stageDraft();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText(/selected sources are not approved for provider export/);
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue(draft.request_text);
        expect(screen.getByRole('button', { name: 'Remove Matrix selection' })).toBeInTheDocument();
        expect(storedContent()).not.toContain(draft.request_text);
    });
});
