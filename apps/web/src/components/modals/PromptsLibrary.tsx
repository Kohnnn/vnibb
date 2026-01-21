// Prompts Library - AI analysis prompt templates

'use client';

import { useState, useEffect } from 'react';
import { X, Search, Plus, Trash2, MessageSquare, TrendingUp, BarChart, FileText, Sparkles } from 'lucide-react';

interface Prompt {
    id: string;
    name: string;
    content: string;
    category: 'analysis' | 'comparison' | 'fundamentals' | 'custom';
    isDefault?: boolean;
}

const DEFAULT_PROMPTS: Prompt[] = [
    {
        id: 'dividend-analysis',
        name: 'Dividend Analysis',
        content: 'Analyze the trend in dividend payouts for this company over the past 5 years. Include dividend yield, payout ratio, and sustainability assessment.',
        category: 'analysis',
        isDefault: true,
    },
    {
        id: 'peer-comparison',
        name: 'VN30 Peer Comparison',
        content: 'Compare the valuation multiples (P/E, P/B, EV/EBITDA) of this company with its VN30 peers. Identify if it is undervalued or overvalued relative to the sector.',
        category: 'comparison',
        isDefault: true,
    },
    {
        id: 'financial-summary',
        name: 'Financial Summary',
        content: 'Summarize the key financials and recent news for this stock. Include revenue growth, profit margins, debt levels, and any significant corporate announcements.',
        category: 'fundamentals',
        isDefault: true,
    },
    {
        id: 'earnings-forecast',
        name: 'Earnings Forecast',
        content: 'Based on the historical earnings data and current market conditions, provide an outlook for the next quarter\'s earnings. Include key drivers and risks.',
        category: 'analysis',
        isDefault: true,
    },
    {
        id: 'technical-analysis',
        name: 'Technical Outlook',
        content: 'Provide a technical analysis of this stock including support/resistance levels, trend direction, and key indicators (RSI, MACD, Moving Averages).',
        category: 'analysis',
        isDefault: true,
    },
    {
        id: 'ownership-analysis',
        name: 'Ownership Structure',
        content: 'Analyze the ownership structure of this company. Identify major shareholders, institutional holdings, and any recent changes in ownership patterns.',
        category: 'fundamentals',
        isDefault: true,
    },
];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    analysis: <TrendingUp size={12} />,
    comparison: <BarChart size={12} />,
    fundamentals: <FileText size={12} />,
    custom: <MessageSquare size={12} />,
};

const CATEGORY_COLORS: Record<string, string> = {
    analysis: '#3B82F6',
    comparison: '#10B981',
    fundamentals: '#8B5CF6',
    custom: '#F59E0B',
};

interface PromptsLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectPrompt?: (prompt: string) => void;
}

export function PromptsLibrary({ isOpen, onClose, onSelectPrompt }: PromptsLibraryProps) {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<'all' | Prompt['category']>('all');
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newPromptName, setNewPromptName] = useState('');
    const [newPromptContent, setNewPromptContent] = useState('');

    // Load prompts from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('vnibb-prompts');
        if (stored) {
            setPrompts(JSON.parse(stored));
        } else {
            setPrompts(DEFAULT_PROMPTS);
            localStorage.setItem('vnibb-prompts', JSON.stringify(DEFAULT_PROMPTS));
        }
    }, []);

    // Save prompts to localStorage
    const savePrompts = (newPrompts: Prompt[]) => {
        setPrompts(newPrompts);
        localStorage.setItem('vnibb-prompts', JSON.stringify(newPrompts));
    };

    const handleAddPrompt = () => {
        if (!newPromptName.trim() || !newPromptContent.trim()) return;

        const newPrompt: Prompt = {
            id: `custom-${Date.now()}`,
            name: newPromptName.trim(),
            content: newPromptContent.trim(),
            category: 'custom',
        };

        savePrompts([...prompts, newPrompt]);
        setNewPromptName('');
        setNewPromptContent('');
        setIsAddingNew(false);
    };

    const handleDeletePrompt = (id: string) => {
        savePrompts(prompts.filter(p => p.id !== id));
    };

    const handleSelectPrompt = (prompt: Prompt) => {
        onSelectPrompt?.(prompt.content);
        onClose();
    };

    if (!isOpen) return null;

    const filteredPrompts = prompts.filter(prompt => {
        const matchesSearch = prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            prompt.content.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || prompt.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-2xl max-h-[80vh] bg-[#0b1021] border border-[#1e2a3b] rounded-lg shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2a3b]">
                    <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-blue-400" />
                        <div>
                            <h2 className="text-base font-semibold text-white">Prompts Library</h2>
                            <p className="text-xs text-gray-500">AI analysis templates for Vietnam market</p>
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
                            className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Search and Filters */}
                <div className="px-4 py-3 border-b border-[#1e2a3b]">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                placeholder="Search prompts..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 rounded bg-[#0f1629] border border-[#1e2a3b] text-white text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                        <div className="flex gap-1">
                            {(['all', 'analysis', 'comparison', 'fundamentals', 'custom'] as const).map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${selectedCategory === cat
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]'
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
                    <div className="px-4 py-3 border-b border-[#1e2a3b] bg-[#0f1629]/50">
                        <div className="space-y-2">
                            <input
                                type="text"
                                placeholder="Prompt name..."
                                value={newPromptName}
                                onChange={(e) => setNewPromptName(e.target.value)}
                                className="w-full px-3 py-1.5 rounded bg-[#0f1629] border border-[#1e2a3b] text-white text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                                autoFocus
                            />
                            <textarea
                                placeholder="Prompt content..."
                                value={newPromptContent}
                                onChange={(e) => setNewPromptContent(e.target.value)}
                                rows={3}
                                className="w-full px-3 py-1.5 rounded bg-[#0f1629] border border-[#1e2a3b] text-white text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500/50 resize-none"
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setIsAddingNew(false)}
                                    className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-[#1e2a3b] transition-colors"
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
                <div className="p-4 overflow-y-auto max-h-[calc(80vh-180px)]">
                    <div className="space-y-2">
                        {filteredPrompts.map(prompt => (
                            <div
                                key={prompt.id}
                                className="group flex items-start gap-3 p-3 rounded-lg border border-[#1e2a3b] bg-[#0f1629]/30 hover:bg-[#1e2a3b]/30 hover:border-[#2e3a4b] transition-all cursor-pointer"
                                onClick={() => handleSelectPrompt(prompt)}
                            >
                                {/* Category Icon */}
                                <div
                                    className="w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5"
                                    style={{
                                        backgroundColor: `${CATEGORY_COLORS[prompt.category]}20`,
                                        color: CATEGORY_COLORS[prompt.category]
                                    }}
                                >
                                    {CATEGORY_ICONS[prompt.category]}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xs font-medium text-white group-hover:text-blue-400 transition-colors">
                                            {prompt.name}
                                        </h3>
                                        {prompt.isDefault && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-700/50 text-gray-400">
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">
                                        {prompt.content}
                                    </p>
                                </div>

                                {/* Delete Button (only for custom prompts) */}
                                {!prompt.isDefault && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeletePrompt(prompt.id);
                                        }}
                                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {filteredPrompts.length === 0 && (
                        <div className="text-center py-8">
                            <p className="text-gray-500 text-sm">No prompts found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
