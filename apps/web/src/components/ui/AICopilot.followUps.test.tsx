import { fireEvent, render, screen } from '@testing-library/react';
import { AICopilot } from './AICopilot';
import { consumeCopilotStream, openCopilotChatStream } from '@/lib/api';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn(() => ({ user: null, session: null, loading: false, isConfigured: false, provider: 'supabase', isAdmin: false, adminStatus: 'signed-out', adminError: null, refreshAdminSession: jest.fn(), isGuest: true, signIn: jest.fn(), signUp: jest.fn(), signInWithGoogle: jest.fn(), signInWithMagicLink: jest.fn(), signInAsAdmin: jest.fn(), signInAsGuest: jest.fn(), signOut: jest.fn(), canAdminLogin: false, canGuestLogin: false })) }));
jest.mock('@/lib/queries', () => ({
    useProfile: () => ({ data: null }),
    useStockQuote: () => ({ data: null }),
    useFinancialRatios: () => ({ data: null }),
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

const responseMeta = { responseId: 'r1', provider: 'openrouter', model: 'test-model', mode: 'app_default', latencyMs: 12 };
const followUps = [
    { id: 'peer_comparison', label: 'Compare against peers', prompt: 'Compare VNM against its closest peers on quality, growth, and valuation.', sourceIds: ['VNM-RATIOS'] },
    { id: 'valuation_range', label: 'Break down valuation range', prompt: "Break down VNM's valuation range using the current ratios and price history.", sourceIds: ['VNM-RATIOS'] },
];

describe('AICopilot grounded follow-ups', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        jest.mocked(openCopilotChatStream).mockResolvedValue({} as Response);
    });

    test('renders grounded follow-ups after an answer and sends the prompt on click', async () => {
        jest.mocked(consumeCopilotStream).mockImplementation(async (_response, handlers) => {
            handlers?.onChunk?.('Grounded answer.');
            handlers?.onDone?.({ done: true, responseMeta, followUps, sources: [], artifacts: [], actions: [] });
        });
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Summarize VNM' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Grounded answer.');

        const group = screen.getByLabelText('Suggested follow-up questions');
        expect(group).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Compare against peers' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Compare against peers' }));
        expect(jest.mocked(openCopilotChatStream).mock.calls[1][0].message).toBe(followUps[0].prompt);
    });

    test('renders no follow-up group when the answer carries none', async () => {
        jest.mocked(consumeCopilotStream).mockImplementation(async (_response, handlers) => {
            handlers?.onChunk?.('Plain answer.');
            handlers?.onDone?.({ done: true, responseMeta, followUps: [], sources: [], artifacts: [], actions: [] });
        });
        render(<AICopilot isOpen onClose={() => {}} currentSymbol="VNM" />);
        fireEvent.change(screen.getByRole('textbox', { name: 'VniAgent message' }), { target: { value: 'Hello' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await screen.findByText('Plain answer.');

        expect(screen.queryByLabelText('Suggested follow-up questions')).not.toBeInTheDocument();
    });
});
