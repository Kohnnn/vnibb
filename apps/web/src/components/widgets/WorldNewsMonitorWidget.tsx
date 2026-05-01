'use client';

import { memo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ExternalLink, Globe2, Newspaper, Radio, Rss } from 'lucide-react';
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
  { value: 'global', label: 'Global' },
  { value: 'us', label: 'US' },
  { value: 'europe', label: 'Europe' },
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
  const limit = getNumberConfig(config, 'limit', 50);
  const freshnessHours = getNumberConfig(config, 'freshnessHours', 72);

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
    queryKey: ['world-news-monitor', region, category, limit, freshnessHours],
    queryFn: ({ signal }) => getWorldNews({
      region: region === 'all' ? undefined : region,
      category: category === 'all' ? undefined : category,
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
    ? `${data.source_count} sources / ${data.feed_count} live feeds${data.failed_feed_count ? ` / ${data.failed_feed_count} failed` : ''}`
    : 'Live RSS/Atom sources';
  const exportRows = articles.map((article) => ({
    ...article,
    tags: article.tags.join(', '),
  }));

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
