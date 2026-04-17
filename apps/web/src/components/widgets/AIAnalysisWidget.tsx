'use client';

import { useState, memo, useCallback } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useProfile, useStockQuote, useFinancialRatios } from '@/lib/queries';
import { Sparkles, RefreshCw, BrainCircuit, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import {
    type CopilotActionSuggestion,
    consumeCopilotStream,
    openCopilotChatStream,
    type CopilotArtifact,
    type CopilotResponseMeta,
    type CopilotReasoningStep,
    type CopilotSourceRef,
} from '@/lib/api';
import { CopilotFeedbackBar } from '@/components/ui/CopilotFeedbackBar';
import { CopilotActionPanel } from '@/components/ui/CopilotActionPanel';
import { CopilotArtifactPanel } from '@/components/ui/CopilotArtifactPanel';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { readStoredAISettings } from '@/lib/aiSettings';
import { logClientError } from '@/lib/clientLogger';
import { CopilotEvidencePanel } from '@/components/ui/CopilotEvidencePanel';

interface AIAnalysisWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function appendReasoningStep(existing: string[], step: CopilotReasoningStep): string[] {
  const line = `[${step.eventType}] ${step.message}`
  return existing[existing.length - 1] === line ? existing : [...existing, line]
}

function AIAnalysisWidgetComponent({ id, symbol, onRemove }: AIAnalysisWidgetProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [sources, setSources] = useState<CopilotSourceRef[]>([]);
  const [artifacts, setArtifacts] = useState<CopilotArtifact[]>([]);
  const [actions, setActions] = useState<CopilotActionSuggestion[]>([]);
  const [responseMeta, setResponseMeta] = useState<CopilotResponseMeta | null>(null);
  const [feedbackVote, setFeedbackVote] = useState<'up' | 'down' | undefined>(undefined);
  const [reasoningLog, setReasoningLog] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data for context
  const { data: profile } = useProfile(symbol);
  const { data: quote } = useStockQuote(symbol);
  const { data: ratios } = useFinancialRatios(symbol);

  const runAnalysis = useCallback(async () => {
    if (isLoading) return;

    const aiSettings = readStoredAISettings()
    captureAnalyticsEvent(ANALYTICS_EVENTS.copilotPromptSubmitted, {
      source: 'analysis_widget',
      symbol,
      widget_context: 'AI Analysis',
      provider: aiSettings.provider,
      mode: aiSettings.mode,
      model: aiSettings.model,
    })
    
    setIsLoading(true);
    setError(null);
    setAnalysis('');
    setSources([]);
    setArtifacts([]);
    setActions([]);
    setResponseMeta(null);
    setFeedbackVote(undefined);
    setReasoningLog([]);
    setShowDetails(false);

    try {
      const context = {
        widgetType: 'AI Analysis',
        symbol,
        dataSnapshot: {
          profile: profile?.data || null,
          quote: quote || null,
          ratios: ratios?.data || null,
        }
      };

      const response = await openCopilotChatStream({
        message: `Perform a deep fundamental and technical analysis for ${symbol}. Provide a summary, pros, cons, and a final rating (Bullish/Neutral/Bearish).`,
        context,
        history: [],
        settings: {
          ...aiSettings,
          enableSidebarWorkflowOutputs: true,
        },
      });

      let fullContent = '';

      await consumeCopilotStream(response, {
        onChunk: (chunk) => {
          fullContent += chunk;
          setAnalysis(fullContent);
        },
        onReasoning: (reasoning) => {
          setReasoningLog((prev) => appendReasoningStep(prev, reasoning));
        },
        onDone: (event) => {
          captureAnalyticsEvent(ANALYTICS_EVENTS.copilotResponseCompleted, {
            source: 'analysis_widget',
            symbol,
            widget_context: 'AI Analysis',
            provider: event.responseMeta?.provider || aiSettings.provider,
            model: event.responseMeta?.model || aiSettings.model,
            latency_ms: event.responseMeta?.latencyMs,
            source_count: event.sources?.length || 0,
            artifact_count: event.artifacts?.length || 0,
            action_count: event.actions?.length || 0,
          })
          setSources(event.sources || []);
          setArtifacts(event.artifacts || []);
          setActions(event.actions || []);
          setResponseMeta(event.responseMeta || null);
        },
      });
    } catch (err: any) {
      logClientError('AI Analysis Error:', err);
      captureAnalyticsEvent(ANALYTICS_EVENTS.copilotResponseFailed, {
        source: 'analysis_widget',
        symbol,
        widget_context: 'AI Analysis',
        provider: aiSettings.provider,
        mode: aiSettings.mode,
        error_type: err?.name || err?.message || 'analysis_failed',
      })
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
        <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
        {/* Actions bar */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--border-default)] bg-[var(--bg-primary)]">
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-cyan-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Appwrite-First AI</span>
          </div>
          <div className="flex items-center gap-2">
            <WidgetMeta note="AI analysis" isFetching={isLoading} align="right" />
            <button
              onClick={runAnalysis}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  runAnalysis();
                }
              }}
              disabled={isLoading || !profile}
              className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all",
                  isLoading 
                      ? "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed" 
                      : "bg-cyan-600 text-white hover:bg-cyan-500 shadow-lg shadow-cyan-900/20"
              )}
              aria-label={analysis ? 'Re-analyze stock' : 'Analyze stock'}
            >
              {isLoading ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {analysis ? 'Re-Analyze' : 'Analyze Stock'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 scrollbar-hide">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-500/60 gap-2 text-center p-6">
                <AlertTriangle size={32} />
                <p className="text-xs font-bold uppercase">{error}</p>
                <button
                  onClick={runAnalysis}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      runAnalysis();
                    }
                  }}
                  className="mt-2 text-[10px] text-blue-400 underline uppercase"
                  aria-label="Retry analysis"
                >
                  Retry Analysis
                </button>
            </div>
          ) : analysis ? (
            <div className="space-y-3">
              <div className="prose prose-sm max-w-none text-[var(--text-secondary)] prose-headings:text-[var(--text-primary)] prose-strong:text-[var(--text-primary)] prose-p:leading-relaxed prose-headings:mb-2 prose-headings:mt-4 first:prose-headings:mt-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {analysis}
                  </ReactMarkdown>
              </div>
              {(Boolean(reasoningLog.length) || responseMeta || actions.length || artifacts.length || sources.length) && (
                <button
                  type="button"
                  onClick={() => setShowDetails((current) => !current)}
                  className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Details
                </button>
              )}
              {showDetails && (
                <div className="space-y-3">
                  {Boolean(reasoningLog.length) && (
                    <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] leading-relaxed text-cyan-100/80 whitespace-pre-wrap">
                      {reasoningLog.join('\n')}
                    </div>
                  )}
                  {responseMeta && (
                    <CopilotFeedbackBar
                      responseMeta={responseMeta}
                      surface="analysis"
                      currentVote={feedbackVote}
                      onVoteChange={(vote) => setFeedbackVote(vote)}
                    />
                  )}
                  {Boolean(actions.length) && (
                    <CopilotActionPanel actions={actions} responseMeta={responseMeta || undefined} surface="analysis" />
                  )}
                  {Boolean(artifacts.length) && (
                    <CopilotArtifactPanel artifacts={artifacts} responseMeta={responseMeta || undefined} surface="analysis" />
                  )}
                  {Boolean(sources.length) && (
                    <CopilotEvidencePanel
                      sources={sources}
                      responseMeta={responseMeta || undefined}
                      surface="analysis"
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-4 text-center opacity-40">
                <div className="relative">
                    <BrainCircuit size={48} strokeWidth={1} />
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-12 h-12 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em]">Ready to analyze {symbol}</p>
                    <p className="text-[10px] mt-1">{reasoningLog[reasoningLog.length - 1] || 'Fundamentals, Valuation & Technical insight'}</p>
                </div>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[9px] text-[var(--text-muted)] italic">
            AI-generated content. For educational purposes only. Verify with your own research.
        </div>
      </div>
    </WidgetContainer>
  );
}

export const AIAnalysisWidget = memo(AIAnalysisWidgetComponent);
export default AIAnalysisWidget;
