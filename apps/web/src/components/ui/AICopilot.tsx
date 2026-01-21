// AI Copilot Sidebar - OpenBB-style AI assistant

'use client';

import { useState, useRef, useEffect } from 'react';
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
    Terminal
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProfile, useStockQuote, useFinancialRatios } from '@/lib/queries';
import { API_BASE_URL } from '@/lib/api';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    timestamp: Date;
}

interface AICopilotProps {
    isOpen: boolean;
    onClose: () => void;
    currentSymbol: string;
    widgetContext?: string;
}

// Suggested prompts for quick actions
const SUGGESTED_PROMPTS = [
    { label: "Analyze", icon: Sparkles, prompt: "Analyze the financial health of this company" },
    { label: "Compare", icon: Bot, prompt: "Compare with industry peers" },
    { label: "Financials", icon: Terminal, prompt: "Summarize recent earnings performance" },
    { label: "Technical", icon: SearchIcon, prompt: "What is the technical outlook for this stock?" },
];

export function AICopilot({ isOpen, onClose, currentSymbol, widgetContext }: AICopilotProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showReasoning, setShowReasoning] = useState<Record<string, boolean>>({});

    // Settings toggles
    const [globalData, setGlobalData] = useState(true);
    const [generativeUI, setGenerativeUI] = useState(true);
    const [webSearch, setWebSearch] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Data fetching for context
    const { data: profile } = useProfile(currentSymbol);
    const { data: quote } = useStockQuote(currentSymbol);
    const { data: ratios } = useFinancialRatios(currentSymbol);

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        }
    }, [isOpen]);

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
            const widgetContextData = {
                widgetType: widgetContext || 'Dashboard',
                symbol: currentSymbol,
                dataSnapshot: {
                    profile: profile?.data || null,
                    quote: quote || null,
                    ratios: ratios?.data || null,
                }
            };

            // Prepare messages for API
            const history = messages.map(m => ({ role: m.role, content: m.content }));

            // Use new SSE streaming endpoint
            const response = await fetch(`${API_BASE_URL}/copilot/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: messageText,
                    context: widgetContextData,
                    history: history
                }),
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            // SSE stream handler
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.chunk) {
                                fullContent += data.chunk;
                                setMessages((prev) => prev.map((msg) =>
                                    msg.id === assistantMsgId
                                        ? { ...msg, content: fullContent }
                                        : msg
                                ));
                            }
                            if (data.done) {
                                // Streaming complete
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

        } catch (error) {
            console.error('Copilot Error:', error);
            setMessages((prev) => prev.map((msg) =>
                msg.id === assistantMsgId
                    ? { ...msg, content: `**Error**: Failed to connect to Copilot service. \n\n${String(error)}` }
                    : msg
            ));
        } finally {
            setIsLoading(false);
        }
    };

    const handleExport = () => {
        if (messages.length === 0) return;

        const content = messages.map(m =>
            `### ${m.role.toUpperCase()} (${m.timestamp.toLocaleTimeString()})\n\n${m.content}\n\n---\n`
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
        <div className="flex flex-col h-full w-full bg-[#0a1628]">
            {/* Header - Optional or integrated */}
            {/* We keep the branding but remove the close button which is now in RightSidebar */}
            {/* If wrapped in RightSidebar, we might want to skip this header or simplify it */}


            {/* Context Badge */}
            <div className="px-4 py-2 border-b border-[#1e3a5f] bg-blue-600/10 flex items-center justify-between">
                <span className="text-xs text-blue-400">
                    {widgetContext ? `Context: @${widgetContext} · ` : ''}{currentSymbol}
                </span>
                {messages.length > 0 && (
                    <button
                        onClick={handleExport}
                        className="p-1 text-gray-400 hover:text-white transition-colors"
                        title="Export chat as Markdown"
                    >
                        <Download size={14} />
                    </button>
                )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <div className="space-y-4">
                        <div className="text-center text-gray-500 py-8">
                            <Bot size={40} className="mx-auto mb-3 text-gray-600" />
                            <p className="text-sm">Ask me anything about {currentSymbol}</p>
                        </div>

                        {/* Suggested Prompts */}
                        <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                                {SUGGESTED_PROMPTS.map((item, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSend(item.prompt)}
                                        className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 bg-[#0d1f3c] rounded-lg hover:bg-[#1e3a5f] hover:text-white transition-colors border border-transparent hover:border-blue-500/30"
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
                                    : 'bg-[#0d1f3c] mr-4 border border-gray-800'
                                    }`}
                            >
                                <div className="text-sm text-gray-200 prose prose-invert prose-sm max-w-none">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {message.content}
                                    </ReactMarkdown>
                                </div>
                            </div>

                            {/* Reasoning Section - Keeping for UI completeness, though custom LLM service might not send it separately yet */}
                            {message.role === 'assistant' && message.reasoning && (
                                <button
                                    onClick={() => toggleReasoning(message.id)}
                                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400"
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
                                <div className="ml-4 p-2 text-xs text-gray-500 bg-gray-900/50 rounded border-l-2 border-blue-500">
                                    {message.reasoning}
                                </div>
                            )}
                        </div>
                    ))
                )}

                {isLoading && messages[messages.length - 1]?.role === 'user' && (
                    <div className="bg-[#0d1f3c] rounded-lg p-3 mr-4">
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <div className="animate-pulse">Thinking...</div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Settings Toggles */}
            <div className="px-4 py-2 border-t border-[#1e3a5f] flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={globalData}
                        onChange={(e) => setGlobalData(e.target.checked)}
                        className="w-3 h-3 rounded"
                    />
                    <Globe size={12} className="text-gray-500" />
                    <span className="text-gray-500">Global data</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={generativeUI}
                        onChange={(e) => setGenerativeUI(e.target.checked)}
                        className="w-3 h-3 rounded"
                    />
                    <Sparkles size={12} className="text-gray-500" />
                    <span className="text-gray-500">Generative UI</span>
                    <span className="px-1 py-0.5 text-[10px] bg-blue-600/20 text-blue-400 rounded">BETA</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={webSearch}
                        onChange={(e) => setWebSearch(e.target.checked)}
                        className="w-3 h-3 rounded"
                    />
                    <SearchIcon size={12} className="text-gray-500" />
                    <span className="text-gray-500">Web Search</span>
                </label>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-[#1e3a5f]">
                <div className="flex items-center gap-2 bg-[#0d1f3c] rounded-lg px-3 py-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask a question..."
                        className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                    />
                    <button
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        className="p-1 text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
