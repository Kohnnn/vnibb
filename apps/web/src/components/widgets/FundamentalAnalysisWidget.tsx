'use client';

import { useEffect } from 'react';
import { FileText } from 'lucide-react';
import { useFundamentalAnalysis } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import type { FundamentalAnalysisData, FundamentalAnalysisItem } from '@/types/equity';

interface FundamentalAnalysisWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function textValue(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function numberValue(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeItems(values: Array<string | FundamentalAnalysisItem> | undefined): FundamentalAnalysisItem[] {
  return (values ?? []).map((item) => (typeof item === 'string' ? { summary: item } : item));
}

function getData(raw: FundamentalAnalysisData | FundamentalAnalysisItem[] | null | undefined): FundamentalAnalysisData | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return { sections: raw };
  return raw;
}

function itemTitle(item: FundamentalAnalysisItem): string {
  return textValue(item.label) || textValue(item.title) || textValue(item.name) || textValue(item.metric) || 'Analysis point';
}

function itemBody(item: FundamentalAnalysisItem): string | null {
  return textValue(item.summary) || textValue(item.description) || textValue(item.verdict) || textValue(item.status) || textValue(item.value);
}

function pct(value: unknown): string | null {
  const numeric = numberValue(value);
  return numeric === null ? null : `${numeric.toFixed(1)}%`;
}

function ratio(value: unknown, suffix = ''): string | null {
  const numeric = numberValue(value);
  return numeric === null ? null : `${numeric.toFixed(1)}${suffix}`;
}

function money(value: unknown): string | null {
  const numeric = numberValue(value);
  return numeric === null ? null : numeric.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function verdictTone(verdict?: string | null): string {
  if (verdict === 'undervalued' || verdict === 'fair_plus') return 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10';
  if (verdict === 'expensive' || verdict === 'stretched') return 'text-rose-300 border-rose-400/30 bg-rose-500/10';
  return 'text-blue-300 border-blue-400/30 bg-blue-500/10';
}

export function FundamentalAnalysisWidget({ symbol, onDataChange }: FundamentalAnalysisWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useFundamentalAnalysis(symbol, Boolean(symbol));
  const payload = getData(data?.data);
  const profile = payload?.profile ?? null;
  const valuation = payload?.valuation ?? null;
  const competitiveAdvantage = payload?.competitive_advantage ?? null;
  const profileDescription = textValue(profile?.description);
  const companyName = textValue(profile?.company_name) || symbol?.toUpperCase();
  const summary = textValue(payload?.summary) || textValue(payload?.thesis) || profileDescription;
  const strengths = normalizeItems(payload?.strengths).slice(0, 3);
  const risks = normalizeItems(payload?.risks).slice(0, 3);
  const sections = [...(payload?.sections ?? payload?.metrics ?? [])].slice(0, 4);
  const hasData = Boolean(summary || strengths.length || risks.length || sections.length || valuation || competitiveAdvantage);
  const source = textValue(payload?.source) || textValue(valuation?.source) || 'vnstock';
  const updatedAt = payload?.updated_at || payload?.generated_at || valuation?.as_of || competitiveAdvantage?.as_of || data?.meta?.last_data_date || dataUpdatedAt;
  const moatFactors = competitiveAdvantage?.moat_factors ?? {};
  const qualityMetrics = competitiveAdvantage?.quality_metrics ?? {};

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/equity',
      endpoint: `/equity/${symbol}/fundamental-analysis`,
      sourceLabel: source,
      lastDataDate: updatedAt,
      stale: Boolean(error && hasData),
      extra: { sections: sections.length, strengths: strengths.length, risks: risks.length },
    }));
  }, [error, hasData, onDataChange, risks.length, sections.length, source, strengths.length, symbol, updatedAt]);

  if (!symbol) return <WidgetEmpty message="Select a symbol to view fundamental analysis" icon={<FileText size={18} />} />;
  if (isLoading && !hasData) return <WidgetSkeleton lines={6} />;
  if (error && !hasData) return <WidgetError title="Fundamental analysis unavailable" error={error as Error} onRetry={() => refetch()} />;
  if (!hasData) return <WidgetEmpty message={`No fundamental analysis available for ${symbol}`} icon={<FileText size={18} />} />;

  return (
    <div className="h-full space-y-3 overflow-auto">
      <WidgetMeta updatedAt={updatedAt} isFetching={isFetching && hasData} isCached={Boolean(error && hasData)} note="Fundamental analysis" align="right" />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {valuation && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Valuation</div>
                <div className="mt-2 text-2xl font-black text-[var(--text-primary)]">{money(valuation.intrinsic_value) ?? 'n/a'}</div>
                <div className="text-xs text-[var(--text-muted)]">Intrinsic value vs price {money(valuation.price) ?? 'n/a'}</div>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${verdictTone(valuation.valuation_verdict)}`}>
                {textValue(valuation.valuation_verdict)?.replace('_', ' ') ?? 'no verdict'}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="MoS" value={pct(valuation.margin_of_safety)} />
              <Metric label="Method" value={textValue(valuation.valuation_method)?.toUpperCase()} />
              <Metric label="P/E" value={ratio(valuation.pe)} />
              <Metric label="P/B" value={ratio(valuation.pb)} />
            </div>
            {valuation.note && <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">{valuation.note}</p>}
          </div>
        )}

        {competitiveAdvantage && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Moat</div>
                <div className="mt-2 text-2xl font-black capitalize text-[var(--text-primary)]">{competitiveAdvantage.moat ?? 'n/a'}</div>
              </div>
              <div className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-300">
                {ratio(competitiveAdvantage.moat_score, '/100') ?? 'score n/a'}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="GM stable" value={ratio(moatFactors.gross_margin_stability, '/100')} />
              <Metric label="Coverage" value={ratio(moatFactors.interest_coverage, 'x')} />
              <Metric label="ROIC spread" value={pct(moatFactors.roic_spread)} />
              <Metric label="Rank" value={ratio(moatFactors.sector_rank_score, '/100')} />
            </div>
            {Array.isArray(competitiveAdvantage.reasons) && competitiveAdvantage.reasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {competitiveAdvantage.reasons.slice(0, 8).map((reason) => (
                  <span key={reason} className="rounded-full bg-[var(--bg-tertiary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">{reason}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {summary && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Thesis</div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">{summary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="ROE" value={pct(qualityMetrics.roe)} />
        <Metric label="ROA" value={pct(qualityMetrics.roa)} />
        <Metric label="Net margin" value={pct(qualityMetrics.net_margin)} />
        <Metric label="Debt/equity" value={ratio(qualityMetrics.debt_to_equity)} />
        <Metric label="Revenue CAGR" value={pct(qualityMetrics.revenue_cagr_5y)} />
        <Metric label="Profit CAGR" value={pct(qualityMetrics.profit_cagr_5y)} />
        <Metric label="FCF" value={typeof qualityMetrics.fcf_positive === 'boolean' ? (qualityMetrics.fcf_positive ? 'positive' : 'negative') : null} />
        <Metric label="Dividend" value={ratio(qualityMetrics.dividend_years, 'y')} />
      </div>

      {(strengths.length > 0 || risks.length > 0) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PointList title="Strengths" items={strengths} tone="positive" />
          <PointList title="Risks" items={risks} tone="negative" />
        </div>
      )}

      {sections.length > 0 && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {sections.map((item, index) => (
            <div key={`${itemTitle(item)}-${index}`} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-[var(--text-primary)]">{itemTitle(item)}</div>
                {typeof item.score === 'number' && <div className="text-xs font-bold text-blue-300">{item.score.toFixed(1)}</div>}
              </div>
              {itemBody(item) && <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{itemBody(item)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--text-primary)]">{value ?? 'n/a'}</div>
    </div>
  );
}

function PointList({ title, items, tone }: { title: string; items: FundamentalAnalysisItem[]; tone: 'positive' | 'negative' }) {
  if (items.length === 0) return null;
  const toneClass = tone === 'positive' ? 'text-emerald-300' : 'text-amber-300';

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
      <div className={`text-[10px] font-black uppercase tracking-[0.2em] ${toneClass}`}>{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div key={`${itemTitle(item)}-${index}`} className="text-xs leading-relaxed text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{itemTitle(item)}: </span>
            {itemBody(item) || 'No detail provided'}
          </div>
        ))}
      </div>
    </div>
  );
}

export default FundamentalAnalysisWidget;
