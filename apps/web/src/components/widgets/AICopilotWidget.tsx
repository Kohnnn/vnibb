// AI Copilot Widget - Enhanced with SSE streaming and markdown rendering

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Loader2, X, Download, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_BASE_URL } from '@/lib/api';

interface WidgetContext {
    widgetType: string;
    symbol: string;
    dataSnapshot?: Record<string, unknown>;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    context?: WidgetContext;
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

            const response = await fetch(`${API_BASE_URL}/copilot/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    context: context || null,
                    history: historyForRequest,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';

            if (reader) {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.chunk) {
                                    fullContent += data.chunk;
                                    setMessages(prev => prev.map(m =>
                                        m.id === assistantMsgId
                                            ? { ...m, content: fullContent }
                                            : m
                                    ));
                                }
                                if (data.done) {
                                    setMessages(prev => prev.map(m =>
                                        m.id === assistantMsgId
                                            ? { ...m, isStreaming: false }
                                            : m
                                    ));
                                }
                                if (data.error) {
                                    throw new Error(data.error);
                                }
                            } catch (e) {
                                // Ignore JSON parse errors for incomplete chunks
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId
                        ? { ...m, content: m.content + '\n\n*[Cancelled]*', isStreaming: false }
                        : m
                ));
            } else {
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

        await handleStreamResponse(messageText);
        setIsLoading(false);
    };

    const handleCancel = () => {
        abortControllerRef.current?.abort();
        setIsLoading(false);
    };

    const handleQuickPrompt = (prompt: PromptTemplate) => {
        const symbol = context?.symbol || 'VNM';
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
            .map(m => `[${m.role.toUpperCase()}] ${m.content}`)
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
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-purple-400" />
                    <span className="text-sm font-medium text-gray-200">AI Copilot</span>
                    {context?.symbol && (
                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded">
                            {context.symbol}
                        </span>
                    )}
                </div>
                <button
                    onClick={exportChat}
                    className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                    title="Export chat"
                >
                    <Download size={14} />
                </button>
            </div>

            {/* Quick Prompts */}
            <div className="flex flex-wrap gap-1 mb-3">
                {QUICK_PROMPTS.map(prompt => (
                    <button
                        key={prompt.id}
                        onClick={() => handleQuickPrompt(prompt)}
                        disabled={isLoading}
                        className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors disabled:opacity-50"
                    >
                        {prompt.label}
                    </button>
                ))}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
                {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`relative max-w-[90%] rounded-lg px-3 py-2 text-sm group ${message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800/70 text-gray-200'
                            }`}>
                            {/* Markdown content */}
                            <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {message.content || (message.isStreaming ? '...' : '')}
                                </ReactMarkdown>
                            </div>

                            {/* Streaming indicator */}
                            {message.isStreaming && (
                                <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1" />
                            )}

                            {/* Copy button */}
                            {message.role === 'assistant' && !message.isStreaming && message.content && (
                                <button
                                    onClick={() => copyMessage(message.content, message.id)}
                                    className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300 transition-all"
                                >
                                    {copiedId === message.id ? <Check size={12} /> : <Copy size={12} />}
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-800">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={context?.symbol ? `Ask about ${context.symbol}...` : 'Ask about stocks...'}
                    disabled={isLoading}
                    className="flex-1 px-3 py-2 text-sm bg-gray-800/50 border border-gray-700 rounded-lg focus:border-purple-500 focus:outline-none text-white placeholder-gray-500 disabled:opacity-50"
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
                        className="p-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                        <Send size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
