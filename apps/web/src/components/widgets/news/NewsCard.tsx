'use client';

import { memo } from 'react';
import { ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/formatDate';
import { normalizeNewsItemTimestamp } from '@/lib/newsTime';
import { EMPTY_VALUE } from '@/lib/units';

interface NewsCardProps {
  news: {
    id: string;
    title: string;
    summary?: string;
    source: string;
    published_at?: string | null;
    published_date?: string | null;
    publishedDate?: string | null;
    created_at?: string | null;
    timestamp?: string | number | null;
    url: string;
    symbols: string[];
    sentiment: 'positive' | 'negative' | 'neutral' | 'bullish' | 'bearish' | null;
    matched_symbols?: string[];
    relevance_score?: number | null;
    match_reason?: string | null;
    is_market_wide_fallback?: boolean;
    association_class?: string | null;
    // #250: declared only; absent means the origin was never recorded.
    sentiment_source?: 'provider' | 'heuristic' | 'unavailable' | null;
  };
}

// Provider-classified direction, kept on the direction tokens because the card
// names it in words as well: colour is never the only signal (brand §13).
const SENTIMENT_CONFIG = {
  positive: { icon: TrendingUp, label: 'Positive', color: 'text-[var(--color-positive)]', bg: 'bg-[var(--color-positive-bg)]' },
  bullish: { icon: TrendingUp, label: 'Bullish', color: 'text-[var(--color-positive)]', bg: 'bg-[var(--color-positive-bg)]' },
  negative: { icon: TrendingDown, label: 'Negative', color: 'text-[var(--color-negative)]', bg: 'bg-[var(--color-negative-bg)]' },
  bearish: { icon: TrendingDown, label: 'Bearish', color: 'text-[var(--color-negative)]', bg: 'bg-[var(--color-negative-bg)]' },
  neutral: { icon: Minus, label: 'Neutral', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--bg-hover)]' },
};

export function getSentimentBadgeTone(sentiment: string | null | undefined) {
  const key = (sentiment || 'neutral').toLowerCase() as keyof typeof SENTIMENT_CONFIG;
  return SENTIMENT_CONFIG[key] || SENTIMENT_CONFIG.neutral;
}

/** #250: where a direction word came from; unrecorded stays unknown. */
export function getSentimentProvenance(source: 'provider' | 'heuristic' | 'unavailable' | null | undefined) {
  if (source === 'provider') {
    return {
      label: 'provider',
      detail: 'Sentiment class as published by the news provider. Not an estimate of stock-price impact.',
    };
  }
  if (source === 'heuristic') {
    return {
      label: 'heuristic',
      detail: 'Sentiment computed locally from the article text (keyword rules or AI model). Not a provider classification and not an estimate of stock-price impact.',
    };
  }
  if (source === 'unavailable') {
    return {
      label: 'Sentiment unavailable',
      detail: 'No sentiment label is recorded for this article. Not an estimate of stock-price impact.',
    };
  }
  return {
    label: 'source unknown',
    detail: 'Where this sentiment label came from is not recorded. Not an estimate of stock-price impact.',
  };
}

function NewsCardComponent({ news }: NewsCardProps) {
  const sentiment = getSentimentBadgeTone(news.sentiment);
  // #250: the association class drives the label, never the score or symbol
  // count -- a sector row has neither, and market-wide fallback must still be
  // visibly distinct. Only direct/verified-peer rows may show a rank.
  const associationClass =
    news.association_class ?? (news.is_market_wide_fallback ? 'general_market' : null);
  const ranked =
    associationClass === 'direct_company' || associationClass === 'verified_peer';
  const associationLabel =
    associationClass === 'direct_company' || associationClass === 'verified_peer'
      ? news.match_reason?.replaceAll('_', ' ') || 'Association unverified'
      : associationClass === 'verified_sector'
        ? 'Industry overlap · no company evidence'
        : associationClass === 'general_market'
          ? 'Market-wide fallback'
          : 'Association unverified';
  const associationDetail =
    associationClass === 'direct_company' || associationClass === 'verified_peer'
      ? 'Rule-based ranking score, not a probability of company relevance.'
      : associationClass === 'verified_sector'
        ? 'Shared industry only. No company evidence, so no relevance score is shown.'
        : associationClass === 'general_market'
          ? 'Broad market article, not an association with this issuer.'
          : 'Association metadata unavailable; no company evidence.';
  const SentimentIcon = sentiment.icon;
  const provenance = getSentimentProvenance(news.sentiment_source);
  // #250: "unavailable" means no label exists; a direction would fabricate one.
  const hasSentiment = news.sentiment_source !== 'unavailable';
  // A missing source publication date is unknown, never "now" (brand §22).
  const publishedLabel = formatTimestamp(
    normalizeNewsItemTimestamp(news as unknown as Record<string, unknown>),
  );

  return (
    <a
      href={news.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 hover:bg-[var(--bg-hover)] transition-colors group border-b border-[var(--border-color)] last:border-0"
    >
      <div className="flex gap-3">
        {/* The glyph carries the direction visually; the word is set in the meta
            row at the approved compact size. An 8 px caption was below the
            readable minimum (brand §13). */}
        {hasSentiment && (
          <div className={cn('mt-1 shrink-0 rounded p-1.5', sentiment.bg)}>
            <SentimentIcon className={cn('w-4 h-4', sentiment.color)} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="text-sm text-[var(--text-primary)] font-medium line-clamp-2 mb-1 group-hover:text-[var(--color-accent-secondary)] transition-colors leading-snug">
            {news.title}
          </h4>

          {(associationClass || news.match_reason || news.is_market_wide_fallback) && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {news.matched_symbols?.slice(0, 3).map((symbol) => (
                <span
                  key={`${news.id}-${symbol}`}
                  className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[length:var(--font-size-sm)] font-bold uppercase text-[var(--color-accent-secondary)]"
                >
                  {symbol}
                </span>
              ))}
              <span
                className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[length:var(--font-size-sm)] font-bold uppercase text-[var(--color-accent-secondary)]"
                title={associationDetail}
              >
                {associationLabel}
                {ranked && typeof news.relevance_score === 'number'
                  ? ` · rank ${Math.round(news.relevance_score * 100)}/100`
                  : ''}
              </span>
            </div>
          )}

          {/* Summary */}
          {news.summary && (
            <p className="text-xs text-[var(--text-muted)] line-clamp-2 mb-2 leading-relaxed">
              {news.summary}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-tighter">
            <span className="px-1.5 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-secondary)]">{news.source}</span>
            {hasSentiment ? (
              <>
                <span className={cn('flex items-center gap-1 rounded border border-[var(--color-state-border)] px-1.5 py-0.5 text-[length:var(--font-size-sm)] font-bold normal-case', sentiment.color)}>
                  <SentimentIcon className="w-3 h-3" aria-hidden />
                  {sentiment.label}
                </span>
                <span
                  role="note"
                  title={provenance.detail}
                  aria-label={`Article sentiment: ${sentiment.label} (${provenance.label}). ${provenance.detail}`}
                  className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[length:var(--font-size-sm)] font-bold normal-case"
                >
                  {provenance.label}
                </span>
              </>
            ) : (
              <span
                role="note"
                title={provenance.detail}
                aria-label={`Article sentiment: Sentiment unavailable. ${provenance.detail}`}
                className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[length:var(--font-size-sm)] font-bold normal-case"
              >
                Sentiment unavailable
              </span>
            )}
            <span>•</span>
            <span className="flex items-center gap-1">
                {publishedLabel === '-' ? (
                  <span title="The provider did not supply a publication date for this item.">{EMPTY_VALUE}</span>
                ) : publishedLabel}
            </span>
            
            {news.symbols && news.symbols.length > 0 && (
              <>
                <span>•</span>
                <div className="flex gap-1">
                  {news.symbols.slice(0, 3).map(s => (
                    <span key={s} className="px-1.5 py-0.5 bg-[var(--color-state-bg)] text-[var(--color-accent-secondary)] border border-[var(--color-state-border)] rounded">
                      {s}
                    </span>
                  ))}
                </div>
              </>
            )}

            <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>
    </a>
  );
}

export const NewsCard = memo(NewsCardComponent);
export default NewsCard;
