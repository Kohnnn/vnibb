'use client';

import { useState, memo, useCallback } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useProfile, useStockQuote, useFinancialRatios } from '@/lib/queries';
import { Sparkles, RefreshCw, BrainCircuit, AlertTriangle, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/lib/api';

interface AIAnalysisWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function AIAnalysisWidgetComponent({ id, symbol, onRemove }: AIAnalysisWidgetProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data for context
  const { data: profile } = useProfile(symbol);
  const { data: quote } = useStockQuote(symbol);
  const { data: ratios } = useFinancialRatios(symbol);

  const runAnalysis = useCallback(async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    setError(null);
    setAnalysis('');

    try {
      const context = {
        widgetType: 'AI Analysis',
        symbol,
        data: {
          profile: profile?.data || null,
          quote: quote || null,
          ratios: ratios?.data || null,
        }
      };

      const response = await fetch(`${API_BASE_URL}/copilot/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Perform a deep fundamental and technical analysis for ${symbol}. Provide a summary, pros, cons, and a final rating (Bullish/Neutral/Bearish).`,
          context,
          history: []
        }),
      });

      if (!response.ok) throw new Error('Failed to start analysis');
      if (!response.body) throw new Error('No response body');

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
                setAnalysis(fullContent);
              }
              if (data.error) throw new Error(data.error);
            } catch (e) {
              // Ignore partial JSON errors
            }
          }
        }
      }
    } catch (err: any) {
      console.error('AI Analysis Error:', err);
      setError(err.message || 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, profile, quote, ratios, isLoading]);

  return (
    <WidgetContainer
      title="AI Analysis"
      symbol={symbol}
      onRefresh={runAnalysis}
      onClose={onRemove}
      isLoading={isLoading}
      widgetId={id}
      showLinkToggle
    >
      <div className="h-full flex flex-col bg-black overflow-hidden">
        {/* Actions bar */}
        <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-[#0a0a0a]">
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-purple-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Gemini Intelligence</span>
          </div>
          <button
            onClick={runAnalysis}
            disabled={isLoading || !profile}
            className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all",
                isLoading 
                    ? "bg-gray-800 text-gray-500 cursor-not-allowed" 
                    : "bg-purple-600 text-white hover:bg-purple-500 shadow-lg shadow-purple-900/20"
            )}
          >
            {isLoading ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {analysis ? 'Re-Analyze' : 'Analyze Stock'}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 scrollbar-hide">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-500/60 gap-2 text-center p-6">
                <AlertTriangle size={32} />
                <p className="text-xs font-bold uppercase">{error}</p>
                <button onClick={runAnalysis} className="mt-2 text-[10px] text-blue-400 underline uppercase">Retry Analysis</button>
            </div>
          ) : analysis ? (
            <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-headings:mb-2 prose-headings:mt-4 first:prose-headings:mt-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {analysis}
                </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-4 text-center opacity-40">
                <div className="relative">
                    <BrainCircuit size={48} strokeWidth={1} />
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em]">Ready to analyze {symbol}</p>
                    <p className="text-[10px] mt-1">Fundamentals, Valuation & Technical insight</p>
                </div>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/20 text-[9px] text-gray-600 italic">
            AI-generated content. For educational purposes only. Verify with your own research.
        </div>
      </div>
    </WidgetContainer>
  );
}

export const AIAnalysisWidget = memo(AIAnalysisWidgetComponent);
export default AIAnalysisWidget;
