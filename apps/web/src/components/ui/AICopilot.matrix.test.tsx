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
    adminStatus: 'signed-out' as const,
    adminError: null,
    refreshAdminSession: jest.fn(),
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

    test('ten-cell machine references stay out of the editable question and appended edits reach the request', async () => {
        const tenSelection = { snapshot_id: 'owned-ten-cell-snapshot', result_ids: Array.from({ length: 10 }, (_, index) => `result-${index}`) };
        const referenceLines = tenSelection.result_ids.map((id) => JSON.stringify({ company: 'AAA', entity_id: 'AAA', question: 'Revenue', result_id: id, source_scope: 'financials', note: 'reference-only '.repeat(30) }));
        const longDraft = `Research frozen Matrix snapshot ${tenSelection.snapshot_id}, revision frozen-revision, period 2024.\nReferences only; resolve with owner authorization. No trading or execution is authorized.\n${referenceLines.join('\n')}\nLimitations: retained serving observations are not original issuer evidence.`;
        const question = 'Which company has the most reliable cash conversion, and why?';
        expect(longDraft.length).toBeGreaterThan(2000);
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        act(() => { window.dispatchEvent(new CustomEvent(MATRIX_FOLLOWUP_EVENT, { detail: { selection: tenSelection, request_text: longDraft } })); });
        const composer = screen.getByRole('textbox', { name: 'VniAgent message' });
        expect(composer).not.toHaveValue(longDraft);
        expect((composer as HTMLInputElement).value).not.toContain('result-0');
        fireEvent.change(composer, { target: { value: `${(composer as HTMLInputElement).value} ${question}` } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        const request = jest.mocked(openCopilotChatStream).mock.calls[0][0];
        expect(request.message).toContain(question);
        expect(request.message.length).toBeLessThanOrEqual(2000);
        expect(request.matrix_selection).toEqual(tenSelection);
        expect(request.context).toBeUndefined();
        expect(storedContent()).not.toContain(question);
        expect(storedContent()).not.toContain('result-0');
    });

    test('rejects oversized Matrix questions visibly instead of sending text that the model would truncate', () => {
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        stageDraft();
        const question = 'Which figure is audited? ' + 'explain '.repeat(300);
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: question } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/Matrix question is too long/);
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue(question);
        expect(openCopilotChatStream).not.toHaveBeenCalled();
        expect(storedContent()).not.toContain(question);
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
    test('starter workflow disclosure renders once for the reviewed revision and the send carries workflow plus the scoped ticker', async () => {
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" starterPrompt="analyze" starterPromptRequestId={1} starterWorkflow={{ id: 'financial-summary', revision: 1 }} />);
        await screen.findByTitle('Active model: test-model');
        expect(screen.getByRole('note', { name: 'Reviewed workflow requirements' })).toBeInTheDocument();
        expect(screen.getAllByText(/Reviewed workflow financial-summary@1/)).toHaveLength(1);
        expect(screen.getByText(/Scope: symbol · Current symbol: VNM/)).toBeInTheDocument();
        expect(screen.getByText(/Requires: income_statement, balance_sheet, cash_flow, financial_ratios/)).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('Analyze the financial health of this company');
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        const request = jest.mocked(openCopilotChatStream).mock.calls[0][0];
        expect(request.workflow).toEqual({ id: 'financial-summary', revision: 1, symbol: 'VNM' });
        expect(request.context?.symbol).toBe('VNM');
    });

    test('same-requestId symbol/session switch clears the disclosure and no stale workflow is sent', async () => {
        const view = render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" starterPrompt="analyze" starterPromptRequestId={1} starterWorkflow={{ id: 'financial-summary', revision: 1 }} />);
        expect(screen.getByRole('note', { name: 'Reviewed workflow requirements' })).toBeInTheDocument();
        await screen.findByTitle('Active model: test-model');
        view.rerender(<AICopilot isOpen onClose={() => {}} currentSymbol="FPT" widgetContext="Financials" activeTabName="Financials" starterPrompt="analyze" starterPromptRequestId={1} starterWorkflow={{ id: 'financial-summary', revision: 1 }} />);
        expect(screen.queryByRole('note', { name: 'Reviewed workflow requirements' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Fresh FPT question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        const request = jest.mocked(openCopilotChatStream).mock.calls[0][0];
        expect(request.workflow).toBeUndefined();
        expect(request.context?.symbol).toBe('FPT');
    });

    test('new starter request with a new symbol/session stages the workflow exactly once after restore', async () => {
        const view = render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" starterPrompt="analyze" starterPromptRequestId={1} starterWorkflow={{ id: 'financial-summary', revision: 1 }} />);
        await screen.findByTitle('Active model: test-model');
        expect(screen.getByRole('note', { name: 'Reviewed workflow requirements' })).toBeInTheDocument();
        view.rerender(<AICopilot isOpen onClose={() => {}} currentSymbol="FPT" widgetContext="Financials" activeTabName="Financials" starterPrompt="analyze" starterPromptRequestId={2} starterWorkflow={{ id: 'financial-summary', revision: 1 }} />);
        expect(screen.getByRole('note', { name: 'Reviewed workflow requirements' })).toBeInTheDocument();
        expect(screen.getByText(/Scope: symbol · Current symbol: FPT/)).toBeInTheDocument();
        expect(screen.getAllByText(/Reviewed workflow financial-summary@1/)).toHaveLength(1);
        expect(screen.getByRole('textbox', { name: 'VniAgent message' })).toHaveValue('Analyze the financial health of this company');
        view.rerender(<AICopilot isOpen onClose={() => {}} currentSymbol="FPT" widgetContext="Financials" activeTabName="Financials" starterPrompt="analyze" starterPromptRequestId={2} starterWorkflow={{ id: 'financial-summary', revision: 1 }} />);
        expect(screen.getAllByRole('note', { name: 'Reviewed workflow requirements' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        expect(jest.mocked(openCopilotChatStream)).toHaveBeenCalledTimes(1);
        const request = jest.mocked(openCopilotChatStream).mock.calls[0][0];
        expect(request.workflow).toEqual({ id: 'financial-summary', revision: 1, symbol: 'FPT' });
        expect(request.context?.symbol).toBe('FPT');
    });
    test('detached price-chart workspace scopes starter disclosure and workflow to the widget symbol', async () => {
        render(
            <AICopilot
                isOpen
                onClose={() => {}}
                currentSymbol="VNM"
                widgetContext="Price Chart"
                widgetContextData={{ widgetTypeKey: 'price_chart', symbol: 'FPT' }}
                starterPrompt="analyze"
                starterPromptRequestId={1}
                starterWorkflow={{ id: 'financial-summary', revision: 1 }}
            />
        );
        await screen.findByTitle('Active model: test-model');
        expect(screen.getByText(/Scope: symbol · Current symbol: FPT/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Protected frozen answer');
        const request = jest.mocked(openCopilotChatStream).mock.calls[0][0];
        expect(request.workflow).toEqual({ id: 'financial-summary', revision: 1, symbol: 'FPT' });
        expect(request.context?.symbol).toBe('FPT');
    });

    test('detached workspace symbol change clears the old scoped identity without re-staging', async () => {
        const view = render(
            <AICopilot
                isOpen
                onClose={() => {}}
                currentSymbol="VNM"
                widgetContext="Price Chart"
                widgetContextData={{ widgetTypeKey: 'price_chart', symbol: 'FPT' }}
                starterPrompt="analyze"
                starterPromptRequestId={1}
                starterWorkflow={{ id: 'financial-summary', revision: 1 }}
            />
        );
        await screen.findByTitle('Active model: test-model');
        expect(screen.getByText(/Current symbol: FPT/)).toBeInTheDocument();
        view.rerender(
            <AICopilot
                isOpen
                onClose={() => {}}
                currentSymbol="VNM"
                widgetContext="Price Chart"
                widgetContextData={{ widgetTypeKey: 'price_chart', symbol: 'HPG' }}
                starterPrompt="analyze"
                starterPromptRequestId={1}
                starterWorkflow={{ id: 'financial-summary', revision: 1 }}
            />
        );
        expect(screen.queryByRole('note', { name: 'Reviewed workflow requirements' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Current symbol: FPT/)).not.toBeInTheDocument();
    });
});

