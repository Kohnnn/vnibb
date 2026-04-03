// VniAgent Sidebar - OpenBB-style workspace agent

'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import {
    X,
    Send,
    ChevronDown,
    ChevronRight,
    Bot,
    Globe,
    Sparkles,
    Search as SearchIcon,
    Download,
    Terminal,
    type LucideIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProfile, useStockQuote, useFinancialRatios } from '@/lib/queries';
import { PromptsLibrary } from '@/components/modals/PromptsLibrary';
import {
    type CopilotActionSuggestion,
    consumeCopilotStream,
    openCopilotChatStream,
    type CopilotArtifact,
    type CopilotResponseMeta,
    type CopilotReasoningStep,
    type CopilotSourceRef,
} from '@/lib/api';
import { CopilotArtifactPanel } from '@/components/ui/CopilotArtifactPanel';
import { CopilotActionPanel } from '@/components/ui/CopilotActionPanel';
import { CopilotFeedbackBar } from '@/components/ui/CopilotFeedbackBar';
import {
    AI_SETTINGS_UPDATED_EVENT,
    readStoredAISettings,
    writeStoredAISettings,
    type AISettings,
} from '@/lib/aiSettings';
import { CopilotEvidencePanel } from '@/components/ui/CopilotEvidencePanel';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    usedSourceIds?: string[];
    sources?: CopilotSourceRef[];
    artifacts?: CopilotArtifact[];
    actions?: CopilotActionSuggestion[];
    responseMeta?: CopilotResponseMeta;
    feedbackVote?: 'up' | 'down';
    timestamp: Date;
}

interface PersistedMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    usedSourceIds?: string[];
    sources?: CopilotSourceRef[];
    artifacts?: CopilotArtifact[];
    actions?: CopilotActionSuggestion[];
    responseMeta?: CopilotResponseMeta;
    feedbackVote?: 'up' | 'down';
    timestamp: string;
}

interface AICopilotProps {
    isOpen: boolean;
    onClose: () => void;
    currentSymbol: string;
    widgetContext?: string;
    widgetContextData?: Record<string, unknown>;
    activeTabName?: string;
}

interface ConnectedWidgetSummary {
    widgetTypeKey?: string;
    widgetId?: string;
    widgetGroup?: string;
    dataSample?: unknown;
}

type PromptSuggestion = {
    label: string;
    icon: LucideIcon;
    prompt: string;
};

const DEFAULT_PROMPTS: PromptSuggestion[] = [
    { label: "Analyze", icon: Sparkles, prompt: "Analyze the financial health of this company" },
    { label: "Compare", icon: Bot, prompt: "Compare with industry peers" },
    { label: "Financials", icon: Terminal, prompt: "Summarize recent earnings performance" },
    { label: "Technical", icon: SearchIcon, prompt: "What is the technical outlook for this stock?" },
];

const TAB_PROMPTS: Record<string, PromptSuggestion[]> = {
    financials: [
        { label: 'Revenue', icon: Terminal, prompt: 'Analyze revenue growth trend and margin sustainability over the last periods' },
        { label: 'Quality', icon: Sparkles, prompt: 'Assess earnings quality, cash conversion, and balance sheet risk' },
        { label: 'Valuation', icon: Bot, prompt: 'Evaluate whether valuation multiples are justified by fundamentals' },
        { label: 'Risks', icon: SearchIcon, prompt: 'List top fundamental downside risks for this company' },
    ],
    comparison: [
        { label: 'Valuation', icon: Bot, prompt: 'Compare valuations of selected tickers and identify the outlier' },
        { label: 'Profitability', icon: Sparkles, prompt: 'Rank selected tickers by profitability and explain key drivers' },
        { label: 'Quality', icon: Terminal, prompt: 'Which compared ticker has the best quality of earnings and why?' },
        { label: 'Best Pick', icon: SearchIcon, prompt: 'Recommend one ticker from this comparison with clear thesis and risks' },
    ],
    overview: [
        { label: 'Key Risks', icon: SearchIcon, prompt: 'What are the key risks for this stock over the next 6-12 months?' },
        { label: 'Catalysts', icon: Sparkles, prompt: 'What near-term catalysts could move this stock materially?' },
        { label: 'Positioning', icon: Bot, prompt: 'How should I position this stock in a balanced portfolio?' },
        { label: 'Checklist', icon: Terminal, prompt: 'Create a due-diligence checklist before buying this stock' },
    ],
    technical: [
        { label: 'Trend', icon: SearchIcon, prompt: 'Summarize trend, momentum, and volatility context from current setup' },
        { label: 'Levels', icon: Terminal, prompt: 'Identify key support/resistance levels and invalidation points' },
        { label: 'Signals', icon: Sparkles, prompt: 'Explain which technical signals are strongest right now' },
        { label: 'Plan', icon: Bot, prompt: 'Draft a risk-managed trade plan with entry, stop, and target' },
    ],
};

const WIDGET_PROMPTS: Record<string, PromptSuggestion[]> = {
    comparison: [
        { label: 'Best vs Worst', icon: Bot, prompt: 'From this comparison widget, identify the strongest and weakest name and justify both with evidence' },
        { label: 'Valuation Gap', icon: Sparkles, prompt: 'Explain the biggest valuation gap shown in this widget and whether it looks justified' },
        { label: 'Quality Rank', icon: Terminal, prompt: 'Rank the compared names by quality and explain what is driving the ranking' },
        { label: 'One Pick', icon: SearchIcon, prompt: 'Choose one ticker from this comparison and give the cleanest investment case plus key risks' },
    ],
    price_chart: [
        { label: 'Trend Read', icon: SearchIcon, prompt: 'Read this chart like a market technician: trend, momentum, and what matters most now' },
        { label: 'Levels', icon: Terminal, prompt: 'Use this chart context to map support, resistance, invalidation, and key breakout levels' },
        { label: 'Trade Setup', icon: Bot, prompt: 'Draft a risk-managed trade setup from this chart with entry, stop, and target logic' },
        { label: 'Context', icon: Sparkles, prompt: 'Explain what this price action says about sentiment and positioning' },
    ],
    foreign_trading: [
        { label: 'Flow Signal', icon: Sparkles, prompt: 'Explain what this foreign trading widget is signaling about conviction and accumulation' },
        { label: 'Persistence', icon: Terminal, prompt: 'Is the foreign flow persistent or noisy? Summarize the key evidence from this widget' },
        { label: 'Implication', icon: Bot, prompt: 'What does this foreign trading pattern imply for the stock over the next few sessions?' },
        { label: 'Risks', icon: SearchIcon, prompt: 'What would invalidate the bullish or bearish read from this foreign trading widget?' },
    ],
    market_breadth: [
        { label: 'Breadth Read', icon: Sparkles, prompt: 'Summarize what this market breadth widget says about the real health of the market' },
        { label: 'Leaders', icon: Bot, prompt: 'Identify sector leaders and laggards from this widget and explain the rotation' },
        { label: 'Risk-On?', icon: SearchIcon, prompt: 'Does this breadth setup look risk-on, risk-off, or mixed? Explain clearly' },
        { label: 'Next Step', icon: Terminal, prompt: 'Translate this market breadth setup into a practical next-step watchlist or positioning plan' },
    ],
    financials: [
        { label: 'Explain Widget', icon: Terminal, prompt: 'Explain the key takeaways from this financial widget and what matters most for the thesis' },
        { label: 'Quality', icon: Sparkles, prompt: 'Assess earnings quality, cash conversion, and balance-sheet strength from this widget context' },
        { label: 'Weak Points', icon: SearchIcon, prompt: 'Point out the weakest fundamental signals visible in this widget and why they matter' },
        { label: 'Decision', icon: Bot, prompt: 'Using this widget only as the starting point, tell me whether the fundamentals are investable and why' },
    ],
};

function normalizeTabKey(tabName?: string): string {
    if (!tabName) return 'overview';
    const key = tabName.toLowerCase();
    if (key.includes('financial')) return 'financials';
    if (key.includes('comparison')) return 'comparison';
    if (key.includes('technical')) return 'technical';
    if (key.includes('overview')) return 'overview';
    return 'overview';
}

function normalizeWidgetKey(widgetName?: string): string | null {
    if (!widgetName) return null;
    const key = widgetName.toLowerCase();
    if (key.includes('comparison')) return 'comparison';
    if (key.includes('price chart') || key.includes('chart')) return 'price_chart';
    if (key.includes('foreign')) return 'foreign_trading';
    if (key.includes('breadth') || key.includes('sector performance')) return 'market_breadth';
    if (key.includes('financial') || key.includes('income') || key.includes('balance') || key.includes('cash flow') || key.includes('ratio')) return 'financials';
    return null;
}

function getWidgetSummary(widgetContext?: string, widgetContextData?: Record<string, unknown>): ConnectedWidgetSummary | null {
    if (!widgetContext && !widgetContextData) {
        return null;
    }

    const context = widgetContextData || {};
    return {
        widgetTypeKey: typeof context.widgetTypeKey === 'string' ? context.widgetTypeKey : undefined,
        widgetId: typeof context.widgetId === 'string' ? context.widgetId : undefined,
        widgetGroup: typeof context.widgetGroup === 'string' ? context.widgetGroup : undefined,
        dataSample: context.dataSample,
    };
}

function getWidgetDataPreview(widgetSummary: ConnectedWidgetSummary | null): string | null {
    const dataSample = widgetSummary?.dataSample;
    if (Array.isArray(dataSample)) {
        return dataSample.length ? `${dataSample.length} sampled rows attached` : null;
    }
    if (dataSample && typeof dataSample === 'object') {
        const keys = Object.keys(dataSample as Record<string, unknown>).slice(0, 4);
        return keys.length ? `Sample fields: ${keys.join(', ')}` : null;
    }
    if (dataSample !== undefined && dataSample !== null && dataSample !== '') {
        return 'Scalar widget sample attached';
    }
    return null;
}

function getSessionKey(symbol: string, widgetContext?: string, activeTabName?: string): string {
    const widgetKey = normalizeWidgetKey(widgetContext) || 'general';
    const tabKey = normalizeTabKey(activeTabName);
    return `vnibb:copilot:session:${symbol || 'UNKNOWN'}:${widgetKey}:${tabKey}`;
}

function toPersistedMessage(message: Message): PersistedMessage {
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        reasoning: message.reasoning,
        usedSourceIds: message.usedSourceIds,
        sources: message.sources,
        artifacts: message.artifacts,
        actions: message.actions,
        responseMeta: message.responseMeta,
        feedbackVote: message.feedbackVote,
        timestamp: message.timestamp.toISOString(),
    };
}

function fromPersistedMessage(message: PersistedMessage): Message {
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        reasoning: message.reasoning,
        usedSourceIds: message.usedSourceIds,
        sources: message.sources,
        artifacts: message.artifacts,
        actions: message.actions,
        responseMeta: message.responseMeta,
        feedbackVote: message.feedbackVote,
        timestamp: new Date(message.timestamp),
    };
}

function appendSourcesForExport(message: Message): string {
    if (!message.sources?.length) {
        return message.content;
    }

    const sourceLines = message.sources.map((source) => {
        const meta = [source.source, source.asOf ? `as of ${source.asOf}` : null]
            .filter(Boolean)
            .join(', ');
        return `- [${source.id}] ${source.label || source.kind || 'Source'}${meta ? ` (${meta})` : ''}`;
    });

    return `${message.content}\n\n## Sources\n${sourceLines.join('\n')}`;
}

function appendReasoningStep(existing: string | undefined, step: CopilotReasoningStep): string {
    const line = `[${step.eventType}] ${step.message}`;
    return existing ? `${existing}\n${line}` : line;
}

function getProviderLabel(provider: AISettings['provider']): string {
    return provider === 'openai_compatible' ? 'OpenAI-compatible' : 'OpenRouter';
}

function getWidgetAwareIntro(widgetContext?: string, activeTabName?: string, symbol?: string): string {
    const widgetKey = normalizeWidgetKey(widgetContext);
    const tabLabel = activeTabName || 'current workspace';
    if (widgetContext && widgetKey === 'comparison') {
        return `Connected to @${widgetContext} on ${tabLabel} for ${symbol}. Ask me to rank the names, explain valuation gaps, or pick the strongest thesis.`;
    }
    if (widgetContext && widgetKey === 'price_chart') {
        return `Connected to @${widgetContext} on ${tabLabel} for ${symbol}. Ask me to read the setup, define levels, or turn this chart into a trade plan.`;
    }
    if (widgetContext && widgetKey === 'foreign_trading') {
        return `Connected to @${widgetContext} on ${tabLabel} for ${symbol}. Ask me to decode foreign flow, persistence, and what it means for positioning.`;
    }
    if (widgetContext && widgetKey === 'market_breadth') {
        return `Connected to @${widgetContext} on ${tabLabel}. Ask me to explain sector rotation, breadth health, or what the market is signaling.`;
    }
    if (widgetContext) {
        return `Connected to @${widgetContext} on ${tabLabel} for ${symbol}. Ask me to explain the widget, call out anomalies, or connect it to the broader thesis.`;
    }
    return `Ask me anything about ${symbol}`;
}

function getInputPlaceholder(widgetContext?: string): string {
    if (!widgetContext) return 'Ask a question...';
    return `Ask about @${widgetContext}...`;
}

export function AICopilot({
    isOpen,
    onClose,
    currentSymbol,
    widgetContext,
    widgetContextData,
    activeTabName,
}: AICopilotProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showReasoning, setShowReasoning] = useState<Record<string, boolean>>({});
    const [aiSettings, setAISettings] = useState<AISettings>(() => readStoredAISettings());
    const [currentStatus, setCurrentStatus] = useState<string | null>(null);
    const [isPromptLibraryOpen, setIsPromptLibraryOpen] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const contextualStarterKeyRef = useRef<string | null>(null);

    // Data fetching for context
    const { data: profile } = useProfile(currentSymbol);
    const { data: quote } = useStockQuote(currentSymbol);
    const { data: ratios } = useFinancialRatios(currentSymbol);

    const activeTabKey = useMemo(() => normalizeTabKey(activeTabName), [activeTabName]);
    const activeWidgetKey = useMemo(() => normalizeWidgetKey(widgetContext), [widgetContext]);
    const widgetSummary = useMemo(
        () => getWidgetSummary(widgetContext, widgetContextData),
        [widgetContext, widgetContextData]
    );
    const widgetDataPreview = useMemo(() => getWidgetDataPreview(widgetSummary), [widgetSummary]);
    const latestResolvedResponseMeta = useMemo(
        () => [...messages].reverse().find((message) => message.role === 'assistant' && message.responseMeta)?.responseMeta,
        [messages]
    );
    const suggestedPrompts = useMemo(
        () => WIDGET_PROMPTS[activeWidgetKey || ''] || TAB_PROMPTS[activeTabKey] || DEFAULT_PROMPTS,
        [activeTabKey, activeWidgetKey]
    );
    const sessionKey = useMemo(
        () => getSessionKey(currentSymbol, widgetContext, activeTabName),
        [currentSymbol, widgetContext, activeTabName]
    );

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.sessionStorage.getItem(sessionKey);
            if (!raw) {
                setMessages([]);
                return;
            }
            const parsed = JSON.parse(raw) as PersistedMessage[];
            setMessages(parsed.map(fromPersistedMessage));
        } catch {
            setMessages([]);
        }
    }, [sessionKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const limited = messages.slice(-40).map(toPersistedMessage);
            window.sessionStorage.setItem(sessionKey, JSON.stringify(limited));
        } catch {
            // ignore persistence failures
        }
    }, [messages, sessionKey]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        const syncSettings = () => setAISettings(readStoredAISettings());

        window.addEventListener(AI_SETTINGS_UPDATED_EVENT, syncSettings);
        window.addEventListener('storage', syncSettings);
        return () => {
            window.removeEventListener(AI_SETTINGS_UPDATED_EVENT, syncSettings);
            window.removeEventListener('storage', syncSettings);
        };
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        if (!widgetContext) {
            contextualStarterKeyRef.current = null;
            return;
        }
        if (messages.length > 0) return;
        if (contextualStarterKeyRef.current === sessionKey) return;

        contextualStarterKeyRef.current = sessionKey;
        setMessages([
            {
                id: `${Date.now()}-context`,
                role: 'assistant',
                content: getWidgetAwareIntro(widgetContext, activeTabName, currentSymbol),
                timestamp: new Date(),
            },
        ]);
    }, [activeTabName, currentSymbol, isOpen, messages.length, sessionKey, widgetContext]);

    const handleSend = async (prompt?: string) => {
        const messageText = prompt || input.trim();
        if (!messageText) return;
        if (isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: messageText,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        const assistantMsgId = (Date.now() + 1).toString();
        // Add placeholder message
        setMessages((prev) => [...prev, {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
        }]);

        try {
            // Construct context for widget
            const requestContext = {
                widgetType: widgetContext || 'Dashboard',
                widgetTypeKey: widgetSummary?.widgetTypeKey || null,
                activeTab: activeTabName || null,
                symbol: currentSymbol,
                dataSnapshot: {
                    profile: profile?.data || null,
                    quote: quote || null,
                    ratios: ratios?.data || null,
                },
                widgetPayload: widgetContextData || null,
            };

            // Prepare messages for API
            const history = messages.slice(-20).map(m => ({ role: m.role, content: m.content }));

            // Use new SSE streaming endpoint
            const response = await openCopilotChatStream({
                message: messageText,
                context: requestContext,
                history,
                settings: aiSettings,
            });

            let fullContent = '';

            await consumeCopilotStream(response, {
                onChunk: (chunk) => {
                    fullContent += chunk;
                    setMessages((prev) => prev.map((msg) =>
                        msg.id === assistantMsgId
                            ? { ...msg, content: fullContent }
                            : msg
                    ));
                },
                onReasoning: (reasoning) => {
                    setCurrentStatus(reasoning.message);
                    setMessages((prev) => prev.map((msg) =>
                        msg.id === assistantMsgId
                            ? { ...msg, reasoning: appendReasoningStep(msg.reasoning, reasoning) }
                            : msg
                    ));
                },
                onDone: (event) => {
                    setCurrentStatus(null);
                    setMessages((prev) => prev.map((msg) =>
                        msg.id === assistantMsgId
                            ? {
                                ...msg,
                                usedSourceIds: event.usedSourceIds || [],
                                sources: event.sources || [],
                                artifacts: event.artifacts || [],
                                actions: event.actions || [],
                                responseMeta: event.responseMeta,
                            }
                            : msg
                    ));
                },
            });

        } catch (error) {
            console.error('VniAgent Error:', error);
            setCurrentStatus(null);
            setMessages((prev) => prev.map((msg) =>
                msg.id === assistantMsgId
                    ? { ...msg, content: `**Error**: Failed to connect to VniAgent service. \n\n${String(error)}` }
                    : msg
            ));
        } finally {
            setIsLoading(false);
        }
    };

    const handleExport = () => {
        if (messages.length === 0) return;

        const content = messages.map(m =>
            `### ${m.role.toUpperCase()} (${m.timestamp.toLocaleTimeString()})\n\n${appendSourcesForExport(m)}\n\n---\n`
        ).join('\n');

        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `copilot-chat-${currentSymbol}-${new Date().toISOString().slice(0, 10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const toggleReasoning = (messageId: string) => {
        setShowReasoning((prev) => ({
            ...prev,
            [messageId]: !prev[messageId],
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="flex flex-col h-full w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
            <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/70 flex items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">VniAgent</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {widgetContext ? 'Widget-native workspace agent' : 'Workspace-native Vietnam equity agent'}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setIsPromptLibraryOpen(true)}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                    Prompt Library
                </button>
            </div>

            {/* Context Badge */}
            <div className="px-4 py-2 border-b border-[var(--border-color)] bg-blue-600/10 flex items-center justify-between">
                <span className="text-xs text-blue-400">
                    {widgetContext ? `Context: @${widgetContext} · ` : ''}
                    {activeTabName ? `${activeTabName} · ` : ''}
                    {currentSymbol} · {getProviderLabel(aiSettings.provider)} · {aiSettings.mode === 'browser_key' ? `Browser key · ${aiSettings.model}` : `App default · ${latestResolvedResponseMeta?.model || 'admin-managed model'}`}
                </span>
                {messages.length > 0 && (
                    <button
                        onClick={handleExport}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        title="Export VniAgent chat as Markdown"
                        aria-label="Export VniAgent chat"
                    >
                        <Download size={14} />
                    </button>
                )}
            </div>

            {widgetContext && (
                <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/60 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Connected Widget</div>
                            <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">@{widgetContext}</div>
                        </div>
                        <div className="text-right text-[10px] text-[var(--text-muted)]">
                            {widgetSummary?.widgetTypeKey ? <div>{widgetSummary.widgetTypeKey}</div> : null}
                            {widgetSummary?.widgetGroup ? <div>Group: {widgetSummary.widgetGroup}</div> : null}
                        </div>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                        {getWidgetAwareIntro(widgetContext, activeTabName, currentSymbol)}
                    </div>
                    {widgetDataPreview && (
                        <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[10px] text-cyan-100/80">
                            {widgetDataPreview}
                        </div>
                    )}
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <div className="space-y-4">
                        <div className="text-center text-[var(--text-muted)] py-8">
                            <Sparkles size={40} className="mx-auto mb-3 text-cyan-300/70" />
                            <p className="text-sm">{getWidgetAwareIntro(widgetContext, activeTabName, currentSymbol)}</p>
                        </div>

                        {/* Suggested Prompts */}
                        <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                                {suggestedPrompts.map((item, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSend(item.prompt)}
                                        className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors border border-transparent hover:border-blue-500/30"
                                    >
                                        <item.icon size={12} className="text-blue-400" />
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    messages.map((message) => (
                        <div key={message.id} className="space-y-2">
                            <div
                                className={`rounded-lg p-3 ${message.role === 'user'
                                    ? 'bg-blue-600/20 ml-8 border border-blue-500/20'
                                    : 'bg-[var(--bg-secondary)] mr-4 border border-[var(--border-color)]'
                                    }`}
                            >
                                <div className="text-sm text-[var(--text-primary)] prose prose-sm max-w-none">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {message.content}
                                    </ReactMarkdown>
                                </div>
                            </div>

                            {/* Reasoning Section - Keeping for UI completeness, though custom LLM service might not send it separately yet */}
                            {message.role === 'assistant' && message.reasoning && (
                                <button
                                    onClick={() => toggleReasoning(message.id)}
                                    className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                >
                                    {showReasoning[message.id] ? (
                                        <ChevronDown size={12} />
                                    ) : (
                                        <ChevronRight size={12} />
                                    )}
                                    Step-by-step reasoning
                                </button>
                            )}
                            {showReasoning[message.id] && message.reasoning && (
                                <div className="ml-4 p-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)]/70 rounded border-l-2 border-blue-500">
                                    {message.reasoning}
                                </div>
                            )}
                            {message.role === 'assistant' && message.responseMeta && (
                                <div className="mr-4">
                                    <CopilotFeedbackBar
                                        responseMeta={message.responseMeta}
                                        surface="sidebar"
                                        currentVote={message.feedbackVote}
                                        onVoteChange={(vote) => {
                                            setMessages((prev) => prev.map((item) =>
                                                item.id === message.id ? { ...item, feedbackVote: vote } : item
                                            ));
                                        }}
                                    />
                                </div>
                            )}
                            {message.role === 'assistant' && Boolean(message.actions?.length) && (
                                <div className="mr-4">
                                    <CopilotActionPanel
                                        actions={message.actions || []}
                                        responseMeta={message.responseMeta}
                                        surface="sidebar"
                                    />
                                </div>
                            )}
                            {message.role === 'assistant' && Boolean(message.artifacts?.length) && (
                                <div className="mr-4">
                                    <CopilotArtifactPanel
                                        artifacts={message.artifacts || []}
                                        responseMeta={message.responseMeta}
                                        surface="sidebar"
                                    />
                                </div>
                            )}
                            {message.role === 'assistant' && Boolean(message.sources?.length) && (
                                <div className="mr-4">
                                    <CopilotEvidencePanel
                                        sources={message.sources || []}
                                        responseMeta={message.responseMeta}
                                        surface="sidebar"
                                    />
                                </div>
                            )}
                        </div>
                    ))
                )}

                {isLoading && messages[messages.length - 1]?.role === 'user' && (
                    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 mr-4 border border-[var(--border-color)]">
                        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                            <div className="animate-pulse">{currentStatus || 'VniAgent is reasoning...'}</div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Settings Toggles */}
            <div className="px-4 py-2 border-t border-[var(--border-color)] flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={aiSettings.preferAppwriteData}
                        onChange={(e) => setAISettings(writeStoredAISettings({ preferAppwriteData: e.target.checked }))}
                        className="w-3 h-3 rounded"
                    />
                    <Globe size={12} className="text-[var(--text-muted)]" />
                    <span className="text-[var(--text-muted)]">Appwrite first</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={aiSettings.webSearch}
                        onChange={(e) => setAISettings(writeStoredAISettings({ webSearch: e.target.checked }))}
                        className="w-3 h-3 rounded"
                    />
                    <SearchIcon size={12} className="text-[var(--text-muted)]" />
                    <span className="text-[var(--text-muted)]">Web Search</span>
                </label>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-lg px-3 py-2 border border-[var(--border-color)]">
                    <input
                        ref={inputRef}
                        type="text"
                        aria-label="VniAgent message"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder={getInputPlaceholder(widgetContext)}
                        className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none"
                    />
                    <button
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        className="p-1 text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Send message"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>

            <PromptsLibrary
                isOpen={isPromptLibraryOpen}
                onClose={() => setIsPromptLibraryOpen(false)}
                onSelectPrompt={(prompt) => {
                    setInput(prompt);
                    window.setTimeout(() => inputRef.current?.focus(), 0);
                }}
                symbol={currentSymbol}
                widgetContext={widgetContext}
                widgetTypeKey={widgetSummary?.widgetTypeKey || activeWidgetKey}
                activeTabName={activeTabName}
            />
        </div>
    );
}
