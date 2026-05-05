'use client';

import { memo, useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ExternalLink, Globe2, Newspaper, Radio, Rss, X } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatTimestamp } from '@/lib/format';
import {
  getWorldNews,
  type WorldNewsArticle,
  type WorldNewsCategory,
  type WorldNewsRegion,
} from '@/lib/api';

type RegionFilter = 'all' | WorldNewsRegion;
type CategoryFilter = 'all' | WorldNewsCategory;

const REGION_FILTERS: Array<{ value: RegionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'vietnam', label: 'Vietnam' },
  { value: 'us', label: 'US' },
  { value: 'europe', label: 'Europe' },
  { value: 'asia', label: 'Asia' },
  { value: 'middleeast', label: 'Mideast' },
  { value: 'africa', label: 'Africa' },
  { value: 'latam', label: 'LatAm' },
  { value: 'oceania', label: 'Oceania' },
  { value: 'global', label: 'Global' },
];

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: 'all', label: 'All Topics' },
  { value: 'markets', label: 'Markets' },
  { value: 'economy', label: 'Economy' },
  { value: 'business', label: 'Business' },
  { value: 'geopolitics', label: 'Geopolitics' },
  { value: 'technology', label: 'Tech' },
];

const VALID_REGIONS = new Set(REGION_FILTERS.map((item) => item.value));
const VALID_CATEGORIES = new Set(CATEGORY_FILTERS.map((item) => item.value));

function getInitialRegion(config?: Record<string, unknown>): RegionFilter {
  const value = String(config?.region || 'all');
  return VALID_REGIONS.has(value as RegionFilter) ? (value as RegionFilter) : 'all';
}

function getInitialCategory(config?: Record<string, unknown>): CategoryFilter {
  const value = String(config?.category || 'all');
  return VALID_CATEGORIES.has(value as CategoryFilter) ? (value as CategoryFilter) : 'all';
}

function getInitialCustomFeed(config?: Record<string, unknown>) {
  const url = typeof config?.customFeedUrl === 'string' ? config.customFeedUrl.trim() : '';
  if (!url) return null;
  const name = typeof config?.customSourceName === 'string' ? config.customSourceName.trim() : '';
  return { url, name };
}

function getNumberConfig(config: Record<string, unknown> | undefined, key: string, fallback: number) {
  const value = Number(config?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function chipClass(active: boolean) {
  return `rounded-md px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
    active
      ? 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/30'
      : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
  }`;
}

function formatArticleTime(value: string | null) {
  const formatted = formatTimestamp(value);
  return formatted === '-' ? 'Live feed' : formatted;
}

function formatCategory(value: string) {
  return value.replace(/_/g, ' ');
}

function isValidCustomFeedUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function WorldNewsMonitorWidgetComponent({
  id,
  config,
  onRemove,
  hideHeader,
}: {
  id: string;
  config?: Record<string, unknown>;
  onRemove?: () => void;
  hideHeader?: boolean;
}) {
  const [region, setRegion] = useState<RegionFilter>(() => getInitialRegion(config));
  const [category, setCategory] = useState<CategoryFilter>(() => getInitialCategory(config));
  const [customFeed, setCustomFeed] = useState<{ url: string; name: string } | null>(() => getInitialCustomFeed(config));
  const [customUrlInput, setCustomUrlInput] = useState(() => getInitialCustomFeed(config)?.url || '');
  const [customNameInput, setCustomNameInput] = useState(() => getInitialCustomFeed(config)?.name || '');
  const [customError, setCustomError] = useState<string | null>(null);
  const limit = getNumberConfig(config, 'limit', 50);
  const freshnessHours = getNumberConfig(config, 'freshnessHours', 72);

  useEffect(() => {
    setRegion(getInitialRegion(config));
    setCategory(getInitialCategory(config));
    const initialCustomFeed = getInitialCustomFeed(config);
    setCustomFeed(initialCustomFeed);
    setCustomUrlInput(initialCustomFeed?.url || '');
    setCustomNameInput(initialCustomFeed?.name || '');
  }, [config]);

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['world-news-monitor', region, category, limit, freshnessHours, customFeed?.url || '', customFeed?.name || ''],
    queryFn: ({ signal }) => getWorldNews({
      region: region === 'all' ? undefined : region,
      category: category === 'all' ? undefined : category,
      customFeedUrl: customFeed?.url,
      customSourceName: customFeed?.name,
      limit,
      freshnessHours,
      signal,
    }),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const articles = data?.articles || [];
  const hasData = articles.length > 0;
  const isFallback = Boolean(error && hasData);
  const sourceNote = data
    ? `${data.source_count} sources / ${data.feed_count} live feeds${customFeed ? ' / custom RSS' : ''}${data.failed_feed_count ? ` / ${data.failed_feed_count} failed` : ''}`
    : 'Live RSS/Atom sources';
  const exportRows = articles.map((article) => ({
    ...article,
    tags: article.tags.join(', '),
  }));

  function applyCustomFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = customUrlInput.trim();
    if (!nextUrl) {
      setCustomFeed(null);
      setCustomError(null);
      return;
    }
    if (!isValidCustomFeedUrl(nextUrl)) {
      setCustomError('Enter a valid http(s) RSS or Atom feed URL.');
      return;
    }
    setCustomFeed({ url: nextUrl, name: customNameInput.trim() });
    setCustomError(null);
  }

  return (
    <WidgetContainer
      title="World News Monitor"
      widgetId={id}
      exportData={exportRows}
      exportFilename="world_news_monitor"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      hideHeader={hideHeader}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
              <Radio className="h-3 w-3 text-emerald-300" />
              Live Source Links
            </div>
            <WidgetMeta
              updatedAt={dataUpdatedAt}
              isFetching={isFetching && hasData}
              isCached={isFallback}
              note={sourceNote}
              align="right"
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {REGION_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRegion(item.value)}
                className={chipClass(region === item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {CATEGORY_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                className={chipClass(category === item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={applyCustomFeed} className="mt-2 grid gap-1 md:grid-cols-[minmax(0,1fr)_130px_auto]">
            <input
              aria-label="Custom RSS feed URL"
              value={customUrlInput}
              onChange={(event) => setCustomUrlInput(event.target.value)}
              placeholder="Ask a custom RSS feed..."
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-blue-400/50"
            />
            <input
              aria-label="Custom RSS source name"
              value={customNameInput}
              onChange={(event) => setCustomNameInput(event.target.value)}
              placeholder="Source name"
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-blue-400/50"
            />
            <div className="flex gap-1">
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-blue-400/30 bg-blue-400/10 px-2 text-[10px] font-black uppercase text-blue-100 hover:bg-blue-400/20"
              >
                <Radio className="h-3 w-3" />
                Use Feed
              </button>
              {customFeed && (
                <button
                  type="button"
                  aria-label="Clear custom RSS feed"
                  onClick={() => {
                    setCustomFeed(null);
                    setCustomUrlInput('');
                    setCustomNameInput('');
                    setCustomError(null);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </form>
          {customError && <div className="mt-1 text-[10px] font-semibold text-red-300">{customError}</div>}
          {customFeed && (
            <div className="mt-1 truncate text-[10px] text-blue-200/80">
              Custom RSS active: {customFeed.name || customFeed.url}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="No world news found for the selected filters."
              detail="Try All regions/topics or refresh the live feeds."
              icon={<Newspaper size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {articles.map((article: WorldNewsArticle) => (
                <article key={article.id} className="p-3 transition-colors hover:bg-[var(--bg-tertiary)]/30">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-200">
                      Live
                    </span>
                    <span className="rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-200">
                      {article.region}
                    </span>
                    <span className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]">
                      {formatCategory(article.category)}
                    </span>
                    <span className="ml-auto text-[9px] font-bold uppercase text-[var(--text-muted)]">
                      {(article.relevance_score * 100).toFixed(0)}% source fit
                    </span>
                  </div>

                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2 text-sm font-semibold leading-snug text-[var(--text-primary)] hover:text-blue-300"
                  >
                    <span className="line-clamp-2 flex-1">{article.title}</span>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
                  </a>

                  {article.summary && (
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {article.summary}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {formatArticleTime(article.published_at)}
                    </span>
                    <span className="text-[var(--text-muted)]/60">•</span>
                    <span className="flex items-center gap-1 font-bold uppercase text-[var(--text-secondary)]">
                      <Globe2 className="h-2.5 w-2.5" />
                      {article.source_domain}
                    </span>
                    <a
                      href={article.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto rounded border border-[var(--border-color)] px-1.5 py-0.5 font-bold uppercase hover:border-blue-400/50 hover:text-blue-300"
                    >
                      Source
                    </a>
                    <a
                      href={article.feed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded border border-[var(--border-color)] px-1.5 py-0.5 font-bold uppercase hover:border-emerald-400/50 hover:text-emerald-300"
                    >
                      <Rss className="h-2.5 w-2.5" />
                      Feed
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const WorldNewsMonitorWidget = memo(WorldNewsMonitorWidgetComponent);
export default WorldNewsMonitorWidget;
