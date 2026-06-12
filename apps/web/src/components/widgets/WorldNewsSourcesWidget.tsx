'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe2, Library, Radio, Rss } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import {
  getWorldNewsSources,
  getWorldNewsMap,
  type WorldNewsCategory,
  type WorldNewsFailedFeed,
  type WorldNewsLanguage,
  type WorldNewsRegion,
  type WorldNewsSourceInfo,
} from '@/lib/api';

type RegionFilter = 'all' | WorldNewsRegion;
type CategoryFilter = 'all' | WorldNewsCategory;
type LanguageFilter = 'all' | WorldNewsLanguage;

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

const LANGUAGE_FILTERS: Array<{ value: LanguageFilter; label: string }> = [
  { value: 'all', label: 'All Lang' },
  { value: 'vi', label: 'VI' },
  { value: 'en', label: 'EN' },
];

const VALID_REGIONS = new Set(REGION_FILTERS.map((item) => item.value));
const VALID_CATEGORIES = new Set(CATEGORY_FILTERS.map((item) => item.value));
const VALID_LANGUAGES = new Set(LANGUAGE_FILTERS.map((item) => item.value));

function getInitialRegion(config?: Record<string, unknown>): RegionFilter {
  const value = String(config?.region || 'all');
  return VALID_REGIONS.has(value as RegionFilter) ? (value as RegionFilter) : 'all';
}

function getInitialCategory(config?: Record<string, unknown>): CategoryFilter {
  const value = String(config?.category || 'all');
  return VALID_CATEGORIES.has(value as CategoryFilter) ? (value as CategoryFilter) : 'all';
}

function getInitialLanguage(config?: Record<string, unknown>): LanguageFilter {
  const value = String(config?.language || 'all');
  return VALID_LANGUAGES.has(value as LanguageFilter) ? (value as LanguageFilter) : 'all';
}

function chipClass(active: boolean) {
  return `rounded-md px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
    active
      ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30'
      : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
  }`;
}

function formatLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatFailedFeedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function WorldNewsSourcesWidgetComponent({
  id,
  config,
  onRemove,
  hideHeader,
  onDataChange,
}: {
  id: string;
  config?: Record<string, unknown>;
  onRemove?: () => void;
  hideHeader?: boolean;
  onDataChange?: (data: unknown) => void;
}) {
  const [region, setRegion] = useState<RegionFilter>(() => getInitialRegion(config));
  const [category, setCategory] = useState<CategoryFilter>(() => getInitialCategory(config));
  const [language, setLanguage] = useState<LanguageFilter>(() => getInitialLanguage(config));

  useEffect(() => {
    setRegion(getInitialRegion(config));
    setCategory(getInitialCategory(config));
    setLanguage(getInitialLanguage(config));
  }, [config]);

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['world-news-sources', region, category, language],
    queryFn: ({ signal }) => getWorldNewsSources({
      region: region === 'all' ? undefined : region,
      category: category === 'all' ? undefined : category,
      language: language === 'all' ? undefined : language,
      signal,
    }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.slowNews),
    refetchIntervalInBackground: false,
    networkMode: 'online',
  });

  const {
    data: sourceHealth,
    isFetching: isHealthFetching,
  } = useQuery({
    queryKey: ['world-news-source-health', region, category, language],
    queryFn: ({ signal }) => getWorldNewsMap({
      region: region === 'all' ? undefined : region,
      category: category === 'all' ? undefined : category,
      language: language === 'all' ? undefined : language,
      limit: 1,
      freshnessHours: 72,
      signal,
    }),
    staleTime: 5 * 60 * 1000,
    refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.slowNews),
    refetchIntervalInBackground: false,
    networkMode: 'online',
  });

  const sources = data?.sources || [];
  const hasData = sources.length > 0;
  const failedFeeds = useMemo(() => sourceHealth?.failed_feeds || [], [sourceHealth?.failed_feeds]);
  const failedFeedsBySourceId = useMemo(() => {
    const grouped = new Map<string, WorldNewsFailedFeed[]>();
    failedFeeds.forEach((feed) => {
      const current = grouped.get(feed.source_id) || [];
      current.push(feed);
      grouped.set(feed.source_id, current);
    });
    return grouped;
  }, [failedFeeds]);
  const feedCount = sources.reduce((total, source) => total + source.feed_urls.length, 0);
  const geographyCount = new Set(sources.map((source) => source.country_code)).size;
  const tierOneCount = sources.filter((source) => source.tier === 1).length;
  const sourceNote = `${sources.length} sources / ${feedCount} feeds / ${geographyCount} geos${failedFeeds.length ? ` / ${failedFeeds.length} failed` : ''}`;
  const exportRows = sources.map((source) => ({
    ...source,
    feed_urls: source.feed_urls.join(', '),
  }));

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/news',
        endpoint: '/news/world/sources',
        sourceLabel: 'World news source registry',
        lastDataDate: dataUpdatedAt,
        stale: Boolean(error && hasData),
        extra: { count: sources.length },
      }),
    );
  }, [onDataChange, hasData, dataUpdatedAt, error, sources.length]);

  return (
    <WidgetContainer
      title="World News Sources"
      widgetId={id}
      exportData={exportRows}
      exportFilename="world_news_sources"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      hideHeader={hideHeader}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
              <Library className="h-3 w-3 text-sky-300" />
              Source Registry
            </div>
            <WidgetMeta
              updatedAt={dataUpdatedAt}
              isFetching={(isFetching || isHealthFetching) && hasData}
              isCached={Boolean(error && hasData)}
              note={sourceNote}
              align="right"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {REGION_FILTERS.map((item) => (
              <button key={item.value} type="button" onClick={() => setRegion(item.value)} className={chipClass(region === item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {CATEGORY_FILTERS.map((item) => (
              <button key={item.value} type="button" onClick={() => setCategory(item.value)} className={chipClass(category === item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {LANGUAGE_FILTERS.map((item) => (
              <button key={item.value} type="button" onClick={() => setLanguage(item.value)} className={chipClass(language === item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 text-center">
          <div className="px-2 py-2">
            <div className="text-lg font-black leading-none text-[var(--text-primary)]">{sources.length}</div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Sources</div>
          </div>
          <div className="border-x border-[var(--border-subtle)] px-2 py-2">
            <div className="text-lg font-black leading-none text-[var(--text-primary)]">{feedCount}</div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Feeds</div>
          </div>
          <div className="px-2 py-2">
            <div className="text-lg font-black leading-none text-[var(--text-primary)]">{tierOneCount}</div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Tier 1</div>
          </div>
          <div className="border-l border-[var(--border-subtle)] px-2 py-2">
            <div className="text-lg font-black leading-none text-amber-300">{failedFeeds.length}</div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Failed</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="No world news sources match the selected filters."
              detail="Try All regions/topics/languages or refresh the source registry."
              icon={<Rss size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {sources.map((source: WorldNewsSourceInfo) => {
                const sourceFailedFeeds = failedFeedsBySourceId.get(source.id) || [];

                return (
                <article key={source.id} className="p-3 transition-colors hover:bg-[var(--bg-tertiary)]/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-sky-200">
                          Tier {source.tier}
                        </span>
                        <span className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]">
                          {formatLabel(source.region)}
                        </span>
                        <span className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]">
                          {formatLabel(source.category)}
                        </span>
                        <span className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]">
                          {source.language}
                        </span>
                        {sourceFailedFeeds.length > 0 ? (
                          <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-200">
                            {sourceFailedFeeds.length} failed
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-1.5 truncate text-sm font-black text-[var(--text-primary)]">
                        {source.name}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1 font-bold uppercase text-[var(--text-secondary)]">
                          <Globe2 className="h-2.5 w-2.5" />
                          {source.domain}
                        </span>
                        <span>{source.country_name}</span>
                        <span>{source.map_region}</span>
                      </div>
                    </div>
                    <a
                      href={source.homepage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border-color)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--text-secondary)] hover:border-sky-400/50 hover:text-sky-300"
                    >
                      Source
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {source.feed_urls.map((feedUrl, index) => {
                      const failedFeed = sourceFailedFeeds.find((feed) => feed.feed_url === feedUrl);

                      return (
                      <a
                        key={feedUrl}
                        href={feedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={failedFeed ? `${failedFeed.reason} at ${formatFailedFeedTime(failedFeed.failed_at)}` : undefined}
                        className={failedFeed
                          ? 'inline-flex max-w-full items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200 hover:border-amber-300/50'
                          : 'inline-flex max-w-full items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-200 hover:border-emerald-300/50'}
                      >
                        <Radio className="h-2.5 w-2.5" />
                        Feed {index + 1}{failedFeed ? ' failed' : ''}
                      </a>
                      );
                    })}
                  </div>
                </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const WorldNewsSourcesWidget = memo(WorldNewsSourcesWidgetComponent);
export default WorldNewsSourcesWidget;
