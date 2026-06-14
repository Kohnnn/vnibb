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
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : null;
}

function money(value: unknown): string | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;
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
  const derivedSections = [
    valuation ? {
      title: 'Định giá',
      summary: [
        valuation.valuation_method ? `method ${valuation.valuation_method}` : null,
        money(valuation.intrinsic_value) ? `IV ${money(valuation.intrinsic_value)}` : null,
        pct(valuation.margin_of_safety) ? `MoS ${pct(valuation.margin_of_safety)}` : null,
        valuation.pe ? `P/E ${Number(valuation.pe).toFixed(2)}` : null,
      ].filter(Boolean).join(' | '),
    } : null,
    competitiveAdvantage ? {
      title: 'Lợi thế cạnh tranh',
      summary: [
        competitiveAdvantage.moat ? `moat ${competitiveAdvantage.moat}` : null,
        ...(Array.isArray(competitiveAdvantage.reasons) ? competitiveAdvantage.reasons.slice(0, 3) : []),
      ].filter(Boolean).join(' | '),
    } : null,
    profile ? {
      title: 'Phân tích tổng quan',
      summary: [companyName, textValue(profile.industry), textValue(profile.exchange)].filter(Boolean).join(' | '),
    } : null,
  ].filter(Boolean) as FundamentalAnalysisItem[];
  const sections = [...(payload?.sections ?? payload?.metrics ?? []), ...derivedSections].slice(0, 6);
  const hasData = Boolean(summary || strengths.length || risks.length || sections.length);
  const source = textValue(payload?.source) || 'vnstock';
  const updatedAt = payload?.updated_at || payload?.generated_at || data?.meta?.last_data_date || dataUpdatedAt;

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

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view fundamental analysis" icon={<FileText size={18} />} />;
  }

  if (isLoading && !hasData) {
    return <WidgetSkeleton lines={6} />;
  }

  if (error && !hasData) {
    return <WidgetError title="Fundamental analysis unavailable" error={error as Error} onRetry={() => refetch()} />;
  }

  if (!hasData) {
    return <WidgetEmpty message={`No fundamental analysis available for ${symbol}`} icon={<FileText size={18} />} />;
  }

  return (
    <div className="h-full space-y-3 overflow-auto">
      <WidgetMeta updatedAt={updatedAt} isFetching={isFetching && hasData} isCached={Boolean(error && hasData)} note="Fundamental analysis" align="right" />

      {summary && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Thesis</div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">{summary}</p>
        </div>
      )}

      {(strengths.length > 0 || risks.length > 0) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PointList title="Strengths" items={strengths} tone="positive" />
          <PointList title="Risks" items={risks} tone="negative" />
        </div>
      )}

      {sections.length > 0 && (
        <div className="space-y-2">
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
