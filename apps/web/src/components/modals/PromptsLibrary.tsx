// VniAgent Prompt Library - Context-aware prompt templates

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Plus, Trash2, MessageSquare, TrendingUp, BarChart, FileText, Sparkles, Layers3, LineChart, Newspaper } from 'lucide-react';
import { getCopilotPrompts, type PromptTemplate } from '@/lib/api';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';

type Prompt = PromptTemplate & {
    name: string;
    content: string;
}

const FALLBACK_PROMPTS: Prompt[] = [
    {
        id: 'dividend-analysis',
        label: 'Dividend Analysis',
        name: 'Dividend Analysis',
        template: 'Using {widget_or_symbol} as the primary context, analyze the trend in dividend payouts for {symbol} over the past 5 years. Include dividend yield, payout ratio, and sustainability assessment.',
        content: 'Using {widget_or_symbol} as the primary context, analyze the trend in dividend payouts for {symbol} over the past 5 years. Include dividend yield, payout ratio, and sustainability assessment.',
        category: 'analysis',
        recommendedWidgetKeys: ['unified_financials'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'peer-comparison',
        label: 'Peer Comparison',
        name: 'Peer Comparison',
        template: 'From the current comparison context for {symbol}, compare valuation multiples, profitability, and momentum. Identify the most attractive and least attractive name and explain why.',
        content: 'From the current comparison context for {symbol}, compare valuation multiples, profitability, and momentum. Identify the most attractive and least attractive name and explain why.',
        category: 'comparison',
        recommendedWidgetKeys: ['comparison'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'financial-summary',
        label: 'Financial Summary',
        name: 'Financial Summary',
        template: 'Summarize the key financial signals for {symbol} from {widget_or_symbol}. Focus on revenue growth, margins, leverage, cash generation, and the single biggest balance-sheet risk.',
        content: 'Summarize the key financial signals for {symbol} from {widget_or_symbol}. Focus on revenue growth, margins, leverage, cash generation, and the single biggest balance-sheet risk.',
        category: 'fundamentals',
        recommendedWidgetKeys: ['unified_financials'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'earnings-forecast',
        label: 'Earnings Forecast',
        name: 'Earnings Forecast',
        template: 'Based on the historical earnings data in {widget_or_symbol} and current market conditions, provide an outlook for the next quarter for {symbol}. Include key drivers, key risks, and what would invalidate the forecast.',
        content: 'Based on the historical earnings data in {widget_or_symbol} and current market conditions, provide an outlook for the next quarter for {symbol}. Include key drivers, key risks, and what would invalidate the forecast.',
        category: 'analysis',
        recommendedWidgetKeys: ['unified_financials'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'technical-analysis',
        label: 'Technical Outlook',
        name: 'Technical Outlook',
        template: 'Read the current chart context for {symbol}. Provide support, resistance, trend direction, invalidation levels, and the clearest trade setup from this widget.',
        content: 'Read the current chart context for {symbol}. Provide support, resistance, trend direction, invalidation levels, and the clearest trade setup from this widget.',
        category: 'technical',
        recommendedWidgetKeys: ['price_chart'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'ownership-analysis',
        label: 'Ownership Structure',
        name: 'Ownership Structure',
        template: 'Analyze the ownership and control context for {symbol}. Identify major holders, alignment risks, and anything that could materially affect governance or float.',
        content: 'Analyze the ownership and control context for {symbol}. Identify major holders, alignment risks, and anything that could materially affect governance or float.',
        category: 'fundamentals',
        isDefault: true,
        source: 'system',
    },
    {
        id: 'foreign-flow-read',
        label: 'Foreign Flow Read',
        name: 'Foreign Flow Read',
        template: 'Use {widget_or_symbol} to explain whether foreign participation in {symbol} is persistent accumulation, noisy rotation, or distribution. State what that implies for conviction.',
        content: 'Use {widget_or_symbol} to explain whether foreign participation in {symbol} is persistent accumulation, noisy rotation, or distribution. State what that implies for conviction.',
        category: 'analysis',
        recommendedWidgetKeys: ['foreign_trading'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'breadth-regime',
        label: 'Breadth Regime',
        name: 'Breadth Regime',
        template: 'Using the current market breadth context on {tab}, explain whether the market is risk-on, risk-off, or mixed. Call out sector leadership and what it means for positioning.',
        content: 'Using the current market breadth context on {tab}, explain whether the market is risk-on, risk-off, or mixed. Call out sector leadership and what it means for positioning.',
        category: 'analysis',
        recommendedWidgetKeys: ['market_breadth'],
        isDefault: true,
        source: 'system',
    },
    {
        id: 'news-impact',
        label: 'News Impact',
        name: 'News Impact',
        template: 'Summarize the most important recent news and event risk for {symbol}. Explain what matters immediately versus what matters over the next quarter.',
        content: 'Summarize the most important recent news and event risk for {symbol}. Explain what matters immediately versus what matters over the next quarter.',
        category: 'news',
        isDefault: true,
        source: 'system',
    },
];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    analysis: <TrendingUp size={12} />,
    comparison: <BarChart size={12} />,
    fundamentals: <FileText size={12} />,
    technical: <LineChart size={12} />,
    news: <Newspaper size={12} />,
    custom: <MessageSquare size={12} />,
};

const CATEGORY_COLORS: Record<string, string> = {
    analysis: '#3B82F6',
    comparison: '#10B981',
    fundamentals: '#06B6D4',
    technical: '#8B5CF6',
    news: '#F97316',
    custom: '#F59E0B',
};

function normalizePromptCategory(category?: Prompt['category']): NonNullable<Prompt['category']> {
    if (!category) return 'custom';
    return category;
}

const PROMPTS_STORAGE_KEY = 'vnibb-vniagent-prompts';
const LEGACY_PROMPTS_STORAGE_KEY = 'vnibb-prompts';

interface PromptsLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectPrompt?: (prompt: string) => void;
    symbol?: string;
    widgetContext?: string;
    widgetTypeKey?: string | null;
    activeTabName?: string;
}

function applyPromptContext(
    prompt: string,
    symbol?: string,
    widgetContext?: string,
    activeTabName?: string,
): string {
    const resolvedSymbol = symbol || 'the current symbol';
    const widgetOrSymbol = widgetContext ? `the @${widgetContext} widget` : resolvedSymbol;
    return prompt
        .replaceAll('{symbol}', resolvedSymbol)
        .replaceAll('{widget}', widgetContext || 'current widget')
        .replaceAll('{widget_or_symbol}', widgetOrSymbol)
        .replaceAll('{tab}', activeTabName || 'current workspace');
}

export function PromptsLibrary({ isOpen, onClose, onSelectPrompt, symbol, widgetContext, widgetTypeKey, activeTabName }: PromptsLibraryProps) {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<'all' | Prompt['category']>('all');
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newPromptName, setNewPromptName] = useState('');
    const [newPromptContent, setNewPromptContent] = useState('');

    // Load prompts from localStorage on mount
    useEffect(() => {
        let cancelled = false;

        const loadPrompts = async () => {
            const stored = localStorage.getItem(PROMPTS_STORAGE_KEY) || localStorage.getItem(LEGACY_PROMPTS_STORAGE_KEY);
            let localPrompts: Prompt[] = [];
            if (stored) {
                try {
                    localPrompts = JSON.parse(stored) as Prompt[];
                } catch {
                    localPrompts = [];
                }
            }

            try {
                const response = await getCopilotPrompts();
                if (cancelled) return;
                const serverPrompts = response.prompts.map((prompt) => ({
                    ...prompt,
                    name: prompt.label,
                    content: prompt.template,
                }));
                const merged = [...serverPrompts, ...localPrompts.filter((prompt) => prompt.source !== 'system' && prompt.source !== 'shared')];
                setPrompts(merged);
                localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(merged.filter((prompt) => prompt.source !== 'system' && prompt.source !== 'shared')));
            } catch {
                const fallback = localPrompts.length ? localPrompts : FALLBACK_PROMPTS;
                setPrompts(fallback);
                if (!localPrompts.length) {
                    localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(FALLBACK_PROMPTS.filter((prompt) => !prompt.isDefault)));
                }
            }
        };

        void loadPrompts();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        captureAnalyticsEvent(ANALYTICS_EVENTS.promptLibraryOpened, {
            symbol,
            widget_context: widgetContext,
            widget_type_key: widgetTypeKey,
            tab_name: activeTabName,
        });
    }, [activeTabName, isOpen, symbol, widgetContext, widgetTypeKey]);

    // Save prompts to localStorage
    const savePrompts = (newPrompts: Prompt[]) => {
        setPrompts(newPrompts);
        localStorage.setItem(
            PROMPTS_STORAGE_KEY,
            JSON.stringify(newPrompts.filter((prompt) => !prompt.isDefault && prompt.source !== 'shared'))
        );
    };

    const handleAddPrompt = () => {
        if (!newPromptName.trim() || !newPromptContent.trim()) return;

        const newPrompt: Prompt = {
            id: `custom-${Date.now()}`,
            label: newPromptName.trim(),
            name: newPromptName.trim(),
            template: newPromptContent.trim(),
            content: newPromptContent.trim(),
            category: 'custom',
            source: 'local',
        };

        savePrompts([...prompts, newPrompt]);
        captureAnalyticsEvent(ANALYTICS_EVENTS.promptLibraryPromptAdded, {
            source: 'local',
            prompt_count: prompts.length + 1,
        });
        setNewPromptName('');
        setNewPromptContent('');
        setIsAddingNew(false);
    };

    const handleDeletePrompt = (id: string) => {
        captureAnalyticsEvent(ANALYTICS_EVENTS.promptLibraryPromptDeleted, {
            prompt_count: Math.max(0, prompts.length - 1),
        });
        savePrompts(prompts.filter(p => p.id !== id));
    };

    const handleSelectPrompt = (prompt: Prompt) => {
        captureAnalyticsEvent(ANALYTICS_EVENTS.copilotPromptLibrarySelected, {
            symbol,
            widget_context: widgetContext,
            tab_name: activeTabName,
            source: prompt.source || 'system',
        });
        onSelectPrompt?.(applyPromptContext(prompt.content, symbol, widgetContext, activeTabName));
        onClose();
    };

    const filteredPrompts = useMemo(() => prompts.filter(prompt => {
        const matchesSearch = prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            prompt.content.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || prompt.category === selectedCategory;
        const matchesWidget = !widgetTypeKey || !prompt.recommendedWidgetKeys?.length || prompt.recommendedWidgetKeys.includes(widgetTypeKey);
        return matchesSearch && matchesCategory && matchesWidget;
    }), [prompts, searchQuery, selectedCategory, widgetTypeKey]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-[rgba(0,0,0,0.6)]"
                role="button"
                tabIndex={0}
                aria-label="Close prompts library"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClose();
                    }
                }}
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-2xl max-h-[80vh] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
                    <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-blue-400" />
                        <div>
                            <h2 className="text-base font-semibold text-[var(--text-primary)]">VniAgent Prompt Library</h2>
                            <p className="text-xs text-[var(--text-muted)]">Context-aware prompt templates for Vietnam market research</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsAddingNew(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors text-xs font-medium"
                        >
                            <Plus size={14} />
                            Add Prompt
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            aria-label="Close prompts library"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Search and Filters */}
                <div className="px-4 py-3 border-b border-[var(--border-color)] shrink-0">
                    {(symbol || widgetContext || activeTabName) && (
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                            {symbol ? <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-blue-300">{symbol}</span> : null}
                            {widgetContext ? <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200 inline-flex items-center gap-1"><Layers3 size={10} />@{widgetContext}</span> : null}
                            {activeTabName ? <span className="rounded-full border border-[var(--border-default)] px-2 py-1">{activeTabName}</span> : null}
                        </div>
                    )}
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search
                                size={14}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                            />
                            <input
                                type="text"
                                placeholder="Search prompts..."
                                value={searchQuery}
                                aria-label="Search prompts"
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                        <div className="flex gap-1">
                            {(['all', 'analysis', 'comparison', 'fundamentals', 'technical', 'news', 'custom'] as const).map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${selectedCategory === cat
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                        }`}
                                >
                                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Add New Prompt Form */}
                {isAddingNew && (
                    <div className="px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)] shrink-0">
                        <div className="space-y-2">
                            <input
                                type="text"
                                placeholder="Prompt name..."
                                value={newPromptName}
                                aria-label="Prompt name"
                                onChange={(e) => setNewPromptName(e.target.value)}
                                className="w-full px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                                autoFocus
                            />
                            <textarea
                                placeholder="Prompt content..."
                                value={newPromptContent}
                                aria-label="Prompt content"
                                onChange={(e) => setNewPromptContent(e.target.value)}
                                rows={3}
                                className="w-full px-3 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50 resize-none"
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setIsAddingNew(false)}
                                    className="px-3 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddPrompt}
                                    className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 transition-colors"
                                >
                                    Save Prompt
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Prompts List */}
                <div className="flex-1 min-h-0 p-4 overflow-y-auto">
                    <div className="space-y-2">
                        {filteredPrompts.map(prompt => {
                            const normalizedCategory = normalizePromptCategory(prompt.category);
                            return (
                            <div
                                key={prompt.id}
                                className="group flex items-start gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-accent)] transition-all cursor-pointer"
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleSelectPrompt(prompt);
                                    }
                                }}
                                onClick={() => handleSelectPrompt(prompt)}
                            >
                                {/* Category Icon */}
                                <div
                                    className="w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5"
                                    style={{
                                        backgroundColor: `${CATEGORY_COLORS[normalizedCategory]}20`,
                                        color: CATEGORY_COLORS[normalizedCategory]
                                    }}
                                >
                                    {CATEGORY_ICONS[normalizedCategory]}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xs font-medium text-[var(--text-primary)] group-hover:text-blue-400 transition-colors">
                                            {prompt.name}
                                        </h3>
                                        {prompt.recommendedWidgetKeys?.length ? (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-500/10 text-cyan-300">
                                                Widget-aware
                                            </span>
                                        ) : null}
                                        {prompt.isDefault && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
                                        {applyPromptContext(prompt.content, symbol, widgetContext, activeTabName)}
                                    </p>
                                </div>

                                {/* Delete Button (only for custom prompts) */}
                                {!prompt.isDefault && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeletePrompt(prompt.id);
                                        }}
                                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                                        aria-label={`Delete ${prompt.name}`}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                            )
                        })}
                    </div>

                    {filteredPrompts.length === 0 && (
                        <div className="text-center py-8">
                            <p className="text-[var(--text-muted)] text-sm">No prompts found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
