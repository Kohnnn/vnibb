'use client';

import { memo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ExternalLink, Globe2, Newspaper, Radio, Rss, Zap } from 'lucide-react';
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

function getNumberConfig(config: Record<string, unknown> | undefined, key: string, fallback: number) {
  const value = Number(config?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function chipClass(active: boolean) {
  return `rounded-md px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
    active
      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30'
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

function WorldNewsLiveStreamWidgetComponent({
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
  const limit = getNumberConfig(config, 'limit', 30);
  const freshnessHours = getNumberConfig(config, 'freshnessHours', 24);
  const pollSeconds = Math.max(30, getNumberConfig(config, 'pollSeconds', 60));

  useEffect(() => {
    setRegion(getInitialRegion(config));
    setCategory(getInitialCategory(config));
  }, [config]);

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['world-news-live-stream', region, category, limit, freshnessHours, pollSeconds],
    queryFn: ({ signal }) => getWorldNews({
      region: region === 'all' ? undefined : region,
      category: category === 'all' ? undefined : category,
      limit,
      freshnessHours,
      signal,
    }),
    staleTime: Math.min(30, pollSeconds) * 1000,
    refetchInterval: pollSeconds * 1000,
  });

  const articles = data?.articles || [];
  const hasData = articles.length > 0;
  const isFallback = Boolean(error && hasData);
  const sourceNote = data
    ? `${data.source_count} sources / ${data.feed_count} feeds / ${pollSeconds}s poll`
    : `Polling every ${pollSeconds}s`;
  const exportRows = articles.map((article) => ({
    ...article,
    tags: article.tags.join(', '),
  }));
  const latestArticle = articles[0];

  return (
    <WidgetContainer
      title="World News Live Stream"
      widgetId={id}
      exportData={exportRows}
      exportFilename="world_news_live_stream"
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
              <Radio className={`h-3 w-3 ${isFetching ? 'animate-pulse text-emerald-300' : 'text-emerald-400'}`} />
              Polling Stream
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
        </div>

        <div className="min-h-0 flex-1 overflow-auto scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="No live headlines found for the selected filters."
              detail="Try All regions/topics or refresh the source feeds."
              icon={<Newspaper size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div>
              {latestArticle && (
                <article className="relative overflow-hidden border-b border-[var(--border-subtle)] bg-[#06120d] p-3 text-white">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(16,185,129,0.18),transparent_32%),linear-gradient(135deg,rgba(6,18,13,1),rgba(3,7,18,1))]" />
                  <div className="relative z-10">
                    <div className="mb-2 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-200">
                      <Zap className="h-3 w-3" />
                      Latest Signal
                      <span className="ml-auto text-white/45">{formatArticleTime(latestArticle.published_at)}</span>
                    </div>
                    <a
                      href={latestArticle.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2 text-base font-black leading-tight text-white hover:text-emerald-200"
                    >
                      <span className="line-clamp-3 flex-1">{latestArticle.title}</span>
                      <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
                    </a>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/55">
                      <span className="rounded border border-emerald-300/20 bg-emerald-300/10 px-1.5 py-0.5 font-black uppercase text-emerald-100">
                        {latestArticle.region}
                      </span>
                      <span className="rounded border border-white/10 px-1.5 py-0.5 font-bold uppercase text-white/70">
                        {formatCategory(latestArticle.category)}
                      </span>
                      <span className="flex items-center gap-1 font-bold uppercase text-white/65">
                        <Globe2 className="h-2.5 w-2.5" />
                        {latestArticle.source_domain}
                      </span>
                      <a
                        href={latestArticle.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto hover:text-emerald-200"
                      >
                        Source
                      </a>
                      <a
                        href={latestArticle.feed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-emerald-200"
                      >
                        <Rss className="h-2.5 w-2.5" />
                        Feed
                      </a>
                    </div>
                  </div>
                </article>
              )}

              <div className="divide-y divide-[var(--border-subtle)]">
                {articles.slice(1).map((article: WorldNewsArticle, index) => (
                  <article key={article.id} className="grid grid-cols-[46px_minmax(0,1fr)] gap-3 p-3 transition-colors hover:bg-[var(--bg-tertiary)]/30">
                    <div className="flex flex-col items-center pt-0.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-[10px] font-black text-emerald-300">
                        {String(index + 2).padStart(2, '0')}
                      </span>
                      <span className="mt-1 h-full w-px bg-[var(--border-subtle)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-200">
                          Live
                        </span>
                        <span className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]">
                          {formatCategory(article.category)}
                        </span>
                        <span className="ml-auto flex items-center gap-1 text-[9px] font-bold uppercase text-[var(--text-muted)]">
                          <Clock className="h-2.5 w-2.5" />
                          {formatArticleTime(article.published_at)}
                        </span>
                      </div>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-2 text-sm font-semibold leading-snug text-[var(--text-primary)] hover:text-emerald-300"
                      >
                        <span className="line-clamp-2 flex-1">{article.title}</span>
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
                      </a>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1 font-bold uppercase text-[var(--text-secondary)]">
                          <Globe2 className="h-2.5 w-2.5" />
                          {article.source_domain}
                        </span>
                        <a
                          href={article.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto rounded border border-[var(--border-color)] px-1.5 py-0.5 font-bold uppercase hover:border-emerald-400/50 hover:text-emerald-300"
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
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const WorldNewsLiveStreamWidget = memo(WorldNewsLiveStreamWidgetComponent);
export default WorldNewsLiveStreamWidget;
