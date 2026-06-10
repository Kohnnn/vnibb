'use client';

import { memo, useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ExternalLink, Globe2, Newspaper, Radio, Rss, X, BookmarkPlus, Check } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatTimestamp } from '@/lib/format';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { addNotebookItem } from '@/lib/researchNotebook';
import {
  getWorldNews,
  getWorldNewsSources,
  type WorldNewsArticle,
  type WorldNewsCategory,
  type WorldNewsFailedFeed,
  type WorldNewsRegion,
} from '@/lib/api';

type RegionFilter = 'all' | WorldNewsRegion;
type CategoryFilter = 'all' | WorldNewsCategory;
type TierFilter = 'all' | 'tier1' | 'tier2';

const TIER_FILTERS: Array<{ value: TierFilter; label: string }> = [
  { value: 'all', label: 'All Sources' },
  { value: 'tier1', label: 'Tier 1' },
  { value: 'tier2', label: 'Tier 2+' },
];

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
  return formatted === '-' ? 'Date unavailable' : formatted;
}

function formatFailedFeedTime(value: string) {
  const formatted = formatTimestamp(value);
  return formatted === '-' ? 'just now' : formatted;
}

function FailedFeedsNotice({ failedFeeds }: { failedFeeds: WorldNewsFailedFeed[] }) {
  if (failedFeeds.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] text-amber-100/85">
      <div className="font-black uppercase tracking-[0.14em] text-amber-200">
        {failedFeeds.length} RSS feed{failedFeeds.length === 1 ? '' : 's'} failed
      </div>
      <div className="mt-1 space-y-1">
        {failedFeeds.slice(0, 3).map((feed) => (
          <div key={`${feed.source_id}-${feed.feed_url}`} className="truncate">
            <span className="font-semibold">{feed.source}</span> failed {formatFailedFeedTime(feed.failed_at)}: {feed.reason}
          </div>
        ))}
        {failedFeeds.length > 3 ? <div>+{failedFeeds.length - 3} more failed feeds</div> : null}
      </div>
    </div>
  );
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
  const [tier, setTier] = useState<TierFilter>('all');
  const [customFeed, setCustomFeed] = useState<{ url: string; name: string } | null>(() => getInitialCustomFeed(config));
  const [customUrlInput, setCustomUrlInput] = useState(() => getInitialCustomFeed(config)?.url || '');
  const [customNameInput, setCustomNameInput] = useState(() => getInitialCustomFeed(config)?.name || '');
  const [customError, setCustomError] = useState<string | null>(null);
  const [customNotice, setCustomNotice] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Record<string, boolean>>({});
  const limit = getNumberConfig(config, 'limit', 50);
  const freshnessHours = getNumberConfig(config, 'freshnessHours', 72);

  const handlePinArticle = (article: WorldNewsArticle) => {
    addNotebookItem({
      kind: 'news',
      title: article.title,
      body: article.summary || undefined,
      tags: [article.region, article.category].filter(Boolean),
      sources: [
        {
          label: article.source || article.source_domain,
          sourceName: article.source,
          url: article.url,
          sourceUrl: article.source_url,
          feedUrl: article.feed_url,
          publishedAt: article.published_at || undefined,
        },
      ],
      provenance: {
        sourceLabel: article.source || article.source_domain,
        apiGroup: '/news',
        endpoint: '/news/world',
        updatedAt: article.published_at || undefined,
      },
    });
    setPinnedIds((prev) => ({ ...prev, [article.id]: true }));
  };

  useEffect(() => {
    setRegion(getInitialRegion(config));
    setCategory(getInitialCategory(config));
    const initialCustomFeed = getInitialCustomFeed(config);
    setCustomFeed(initialCustomFeed);
    setCustomUrlInput(initialCustomFeed?.url || '');
    setCustomNameInput(initialCustomFeed?.name || '');
    setCustomNotice(null);
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
    refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.news),
    refetchIntervalInBackground: false,
    networkMode: 'online',
  });

  const articles = data?.articles || [];

  // Tier filter is client-side: the feed endpoint has no tier param, but the
  // source registry (cached 30 min) maps source_id -> tier. Articles from a
  // custom feed have no registry entry and stay visible on every tier.
  const sourcesQuery = useQuery({
    queryKey: ['world-news-sources-registry'],
    queryFn: ({ signal }) => getWorldNewsSources({ signal }),
    staleTime: 30 * 60 * 1000,
    enabled: tier !== 'all',
  });
  const tierBySourceId = new Map(
    (sourcesQuery.data?.sources || []).map((source) => [source.id, source.tier]),
  );
  const visibleArticles = tier === 'all'
    ? articles
    : articles.filter((article) => {
        const sourceTier = tierBySourceId.get(article.source_id);
        if (sourceTier === undefined) return true;
        return tier === 'tier1' ? sourceTier === 1 : sourceTier >= 2;
      });

  const hasData = articles.length > 0;
  const isFallback = Boolean(error && hasData);
  const failedFeeds = data?.failed_feeds || [];
  const customFeedFailure = customFeed
    ? failedFeeds.find((feed) => feed.feed_url === customFeed.url)
    : null;
  const sourceNote = data
    ? `${data.source_count} sources / ${data.feed_count} live feeds${customFeed ? ' / custom RSS' : ''}${data.failed_feed_count ? ` / ${data.failed_feed_count} failed` : ''}`
    : 'Live RSS/Atom sources';
  const exportRows = visibleArticles.map((article) => ({
    ...article,
    tags: article.tags.join(', '),
  }));

  function applyCustomFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = customUrlInput.trim();
    if (!nextUrl) {
      setCustomFeed(null);
      setCustomError(null);
      setCustomNotice('Custom RSS cleared.');
      return;
    }
    if (!isValidCustomFeedUrl(nextUrl)) {
      setCustomError('Enter a valid http(s) RSS or Atom feed URL.');
      setCustomNotice(null);
      return;
    }
    setCustomFeed({ url: nextUrl, name: customNameInput.trim() });
    setCustomError(null);
    setCustomNotice(`Custom RSS queued: ${customNameInput.trim() || nextUrl}`);
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
          <div className="mt-1 flex flex-wrap gap-1">
            {TIER_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setTier(item.value)}
                className={chipClass(tier === item.value)}
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
                    setCustomNotice('Custom RSS cleared.');
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </form>
          {customError && <div role="alert" className="mt-1 text-[10px] font-semibold text-red-300">{customError}</div>}
          {!customError && customNotice && (
            <div className="mt-1 text-[10px] font-semibold text-emerald-300">{customNotice}</div>
          )}
          {customFeedFailure ? (
            <div role="alert" className="mt-1 truncate text-[10px] text-amber-200/90">
              Custom RSS failed {formatFailedFeedTime(customFeedFailure.failed_at)}: {customFeedFailure.reason}
            </div>
          ) : customFeed ? (
            <div className="mt-1 truncate text-[10px] text-blue-200/80">
              Custom RSS active: {customFeed.name || customFeed.url}
            </div>
          ) : null}
          <FailedFeedsNotice failedFeeds={failedFeeds} />
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
          ) : visibleArticles.length === 0 ? (
            <WidgetEmpty
              message="No articles from the selected source tier."
              detail="Switch to All Sources to see every live feed."
              icon={<Newspaper size={18} />}
              action={{ label: 'All Sources', onClick: () => setTier('all') }}
            />
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {visibleArticles.map((article: WorldNewsArticle) => (
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
                    <button
                      type="button"
                      onClick={() => handlePinArticle(article)}
                      disabled={pinnedIds[article.id]}
                      className="flex items-center gap-1 rounded border border-[var(--border-color)] px-1.5 py-0.5 font-bold uppercase transition-colors hover:border-amber-400/50 hover:text-amber-300 disabled:cursor-default disabled:border-emerald-400/40 disabled:text-emerald-300"
                      title={pinnedIds[article.id] ? 'Pinned to research notebook' : 'Pin to research notebook'}
                    >
                      {pinnedIds[article.id] ? <Check className="h-2.5 w-2.5" /> : <BookmarkPlus className="h-2.5 w-2.5" />}
                      {pinnedIds[article.id] ? 'Pinned' : 'Pin'}
                    </button>
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
