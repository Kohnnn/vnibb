// AI Copilot Widget - Enhanced with SSE streaming and markdown rendering

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Loader2, X, Download, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    type CopilotActionSuggestion,
    consumeCopilotStream,
    openCopilotChatStream,
    type CopilotArtifact,
    type CopilotResponseMeta,
    type CopilotReasoningStep,
    type CopilotSourceRef,
} from '@/lib/api';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { readStoredAISettings } from '@/lib/aiSettings';
import { CopilotFeedbackBar } from '@/components/ui/CopilotFeedbackBar';
import { CopilotActionPanel } from '@/components/ui/CopilotActionPanel';
import { CopilotArtifactPanel } from '@/components/ui/CopilotArtifactPanel';
import { CopilotEvidencePanel } from '@/components/ui/CopilotEvidencePanel';

interface WidgetContext {
    widgetType: string;
    symbol: string;
    dataSnapshot?: Record<string, unknown>;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    context?: WidgetContext;
    sources?: CopilotSourceRef[];
    artifacts?: CopilotArtifact[];
    actions?: CopilotActionSuggestion[];
    responseMeta?: CopilotResponseMeta;
    feedbackVote?: 'up' | 'down';
    isStreaming?: boolean;
    timestamp: Date;
}

interface AICopilotWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    initialContext?: WidgetContext;
}

interface PromptTemplate {
    id: string;
    label: string;
    template: string;
}

// Quick prompts for the UI
const QUICK_PROMPTS: PromptTemplate[] = [
    { id: 'analyze', label: '📊 Analyze', template: 'Provide a comprehensive investment analysis for {symbol}' },
    { id: 'compare', label: '⚖️ Compare', template: 'Compare {symbol} with its key competitors' },
    { id: 'financials', label: '💰 Financials', template: 'Summarize the key financial highlights for {symbol}' },
    { id: 'technical', label: '📈 Technical', template: 'Provide technical analysis outlook for {symbol}' },
    { id: 'news', label: '📰 News', template: 'Analyze recent news impact on {symbol}' },
];

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

export function AICopilotWidget({ isEditing, onRemove, initialContext }: AICopilotWidgetProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: '🤖 **AI Copilot** - Your intelligent stock analysis assistant.\n\nAsk me about Vietnamese stocks! Try:\n- "Analyze VNM"\n- "Compare VNM and FPT"\n- "Technical outlook for VCB"',
            timestamp: new Date(),
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [context, setContext] = useState<WidgetContext | undefined>(initialContext);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [currentStatus, setCurrentStatus] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Update context when initialContext changes (from widget "Ask AI" button)
    useEffect(() => {
        if (initialContext) {
            setContext(initialContext);
            // Auto-suggest based on context
            const welcomeMsg = `I'm looking at **${initialContext.widgetType}** for **${initialContext.symbol}**. How can I help?`;
            setMessages(prev => [...prev, {
                id: `ctx-${Date.now()}`,
                role: 'assistant',
                content: welcomeMsg,
                context: initialContext,
                timestamp: new Date(),
            }]);
        }
    }, [initialContext]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleStreamResponse = useCallback(async (userMessage: string) => {
        const messageId = `msg-${Date.now()}`;

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        // Add assistant message placeholder
        const assistantMsgId = `assistant-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            isStreaming: true,
            timestamp: new Date(),
        }]);

        try {
            const historyForRequest = messages
                .filter(m => m.id !== 'welcome')
                .slice(-10) // Last 10 messages for context
                .map(m => ({ role: m.role, content: m.content }));

            const response = await openCopilotChatStream(
                {
                    message: userMessage,
                    context: context || null,
                    history: historyForRequest,
                    settings: readStoredAISettings(),
                },
                abortControllerRef.current.signal,
            );

            let fullContent = '';

            await consumeCopilotStream(response, {
                onChunk: (chunk) => {
                    fullContent += chunk;
                    setMessages(prev => prev.map(m =>
                        m.id === assistantMsgId
                            ? { ...m, content: fullContent }
                            : m
                    ));
                },
                onReasoning: (reasoning) => {
                    setCurrentStatus(reasoning.message);
                    setMessages(prev => prev.map(m =>
                        m.id === assistantMsgId
                            ? { ...m, reasoning: appendReasoningStep(m.reasoning, reasoning) }
                            : m
                    ));
                },
                onDone: (event) => {
                    setCurrentStatus(null);
                    setMessages(prev => prev.map(m =>
                        m.id === assistantMsgId
                            ? {
                                ...m,
                                isStreaming: false,
                                sources: event.sources || [],
                                artifacts: event.artifacts || [],
                                actions: event.actions || [],
                                responseMeta: event.responseMeta,
                            }
                            : m
                    ));
                },
            });
        } catch (error: any) {
            if (error.name === 'AbortError') {
                setCurrentStatus(null);
                setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId
                        ? { ...m, content: m.content + '\n\n*[Cancelled]*', isStreaming: false }
                        : m
                ));
            } else {
                setCurrentStatus(null);
                setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId
                        ? { ...m, content: `❌ Error: ${error.message}\n\nPlease try again.`, isStreaming: false }
                        : m
                ));
            }
        }
    }, [messages, context]);

    const sendMessage = async (content?: string) => {
        const messageText = content || input.trim();
        if (!messageText || isLoading) return;

        // Add user message
        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: messageText,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        setCurrentStatus(null);

        await handleStreamResponse(messageText);
        setIsLoading(false);
    };

    const handleCancel = () => {
        abortControllerRef.current?.abort();
        setIsLoading(false);
    };

    const handleQuickPrompt = (prompt: PromptTemplate) => {
        const symbol = context?.symbol || DEFAULT_TICKER;
        const message = prompt.template.replace('{symbol}', symbol);
        sendMessage(message);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const copyMessage = async (content: string, id: string) => {
        await navigator.clipboard.writeText(content);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const exportChat = () => {
        const chatText = messages
            .map(m => `[${m.role.toUpperCase()}] ${appendSourcesForExport(m)}`)
            .join('\n\n---\n\n');

        const blob = new Blob([chatText], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `copilot-chat-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col h-full p-3 min-h-[300px]">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-cyan-400" />
                    <span className="text-sm font-medium text-[var(--text-primary)]">AI Copilot</span>
                    {context?.symbol && (
                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded">
                            {context.symbol}
                        </span>
                    )}
                    {currentStatus && (
                        <span className="text-[10px] text-cyan-300">{currentStatus}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta note="AI chat" isFetching={isLoading} align="right" />
                    <button
                        onClick={exportChat}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        title="Export chat"
                        aria-label="Export chat"
                    >
                        <Download size={14} />
                    </button>
                </div>
            </div>

            {/* Quick Prompts */}
            <div className="flex flex-wrap gap-1 mb-3">
                {QUICK_PROMPTS.map(prompt => (
                    <button
                        key={prompt.id}
                        onClick={() => handleQuickPrompt(prompt)}
                        disabled={isLoading}
                        className="px-2 py-1 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-md transition-colors disabled:opacity-50"
                    >
                        {prompt.label}
                    </button>
                ))}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
                {messages.map((message) => (
                    <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`relative max-w-[90%] rounded-lg px-3 py-2 text-sm group ${message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                            }`}>
                            {/* Markdown content */}
                            <div className="prose prose-sm max-w-none text-inherit prose-headings:text-[var(--text-primary)] prose-strong:text-[var(--text-primary)] prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {message.content || (message.isStreaming ? '...' : '')}
                                </ReactMarkdown>
                            </div>

                            {/* Streaming indicator */}
                            {message.isStreaming && (
                                <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse ml-1" />
                            )}

                            {message.reasoning && (
                                <div className="mt-2 rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[10px] leading-relaxed text-cyan-100/80 whitespace-pre-wrap">
                                    {message.reasoning}
                                </div>
                            )}

                            {/* Copy button */}
                            {message.role === 'assistant' && !message.isStreaming && message.content && (
                                <button
                                    onClick={() => copyMessage(message.content, message.id)}
                                    className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all"
                                >
                                    {copiedId === message.id ? <Check size={12} /> : <Copy size={12} />}
                                </button>
                            )}
                        </div>
                        {message.role === 'assistant' && Boolean(message.sources?.length) && (
                            <div className="mt-2 w-full max-w-[90%]">
                                <CopilotEvidencePanel sources={message.sources || []} />
                            </div>
                        )}
                        {message.role === 'assistant' && message.responseMeta && (
                            <div className="mt-2 w-full max-w-[90%]">
                                <CopilotFeedbackBar
                                    responseMeta={message.responseMeta}
                                    surface="widget"
                                    currentVote={message.feedbackVote}
                                    onVoteChange={(vote) => {
                                        setMessages((prev) => prev.map((item) =>
                                            item.id === message.id ? { ...item, feedbackVote: vote } : item
                                        ));
                                    }}
                                />
                            </div>
                        )}
                        {message.role === 'assistant' && Boolean(message.artifacts?.length) && (
                            <div className="mt-2 w-full max-w-[90%]">
                                <CopilotArtifactPanel
                                    artifacts={message.artifacts || []}
                                    responseMeta={message.responseMeta}
                                    surface="widget"
                                />
                            </div>
                        )}
                        {message.role === 'assistant' && Boolean(message.actions?.length) && (
                            <div className="mt-2 w-full max-w-[90%]">
                                <CopilotActionPanel
                                    actions={message.actions || []}
                                    responseMeta={message.responseMeta}
                                    surface="widget"
                                />
                            </div>
                        )}
                    </div>
                ))}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--border-color)]">
                <input
                    type="text"
                    value={input}
                    aria-label="Copilot message"
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={context?.symbol ? `Ask about ${context.symbol}...` : 'Ask about stocks...'}
                    disabled={isLoading}
                    className="flex-1 px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg focus:border-cyan-500 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)] disabled:opacity-50"
                />
                {isLoading ? (
                    <button
                        onClick={handleCancel}
                        className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                        title="Cancel"
                    >
                        <X size={16} />
                    </button>
                ) : (
                    <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim()}
                        className="p-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-[var(--bg-tertiary)] disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        aria-label="Send message"
                    >
                        <Send size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
