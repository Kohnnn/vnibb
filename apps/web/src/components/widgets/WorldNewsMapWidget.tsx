'use client';

import { memo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe2, MapPin, Rss } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatTimestamp } from '@/lib/format';
import {
  getWorldNewsMap,
  type WorldNewsCategory,
  type WorldNewsMapBucket,
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
      ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30'
      : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
  }`;
}

function projectMarker(bucket: WorldNewsMapBucket) {
  return {
    x: Math.min(96, Math.max(4, ((bucket.longitude + 180) / 360) * 100)),
    y: Math.min(92, Math.max(8, ((90 - bucket.latitude) / 180) * 100)),
  };
}

function markerSize(articleCount: number) {
  if (articleCount >= 20) return 18;
  if (articleCount >= 10) return 15;
  if (articleCount >= 3) return 12;
  return 10;
}

function formatCategory(value: string | null) {
  return value ? value.replace(/_/g, ' ') : 'No active topic';
}

function formatArticleTime(value: string | null) {
  const formatted = formatTimestamp(value);
  return formatted === '-' ? 'Live feed' : formatted;
}

function WorldNewsMapWidgetComponent({
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const limit = getNumberConfig(config, 'limit', 120);
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
    queryKey: ['world-news-map', region, category, limit, freshnessHours],
    queryFn: ({ signal }) => getWorldNewsMap({
      region: region === 'all' ? undefined : region,
      category: category === 'all' ? undefined : category,
      limit,
      freshnessHours,
      signal,
    }),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const buckets = data?.buckets || [];
  const hasData = buckets.length > 0;
  const selectedBucket = buckets.find((bucket) => bucket.id === selectedId) || buckets[0];
  const isFallback = Boolean(error && hasData);
  const sourceNote = data
    ? `${data.source_count} sources / ${data.feed_count} feeds${data.failed_feed_count ? ` / ${data.failed_feed_count} failed` : ''}`
    : 'Live RSS/Atom geography';
  const exportRows = buckets.map((bucket) => ({
    ...bucket,
    top_sources: bucket.top_sources.join(', '),
    latest_articles: bucket.latest_articles.map((article) => article.url).join(', '),
  }));

  useEffect(() => {
    if (!buckets.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !buckets.some((bucket) => bucket.id === selectedId)) {
      setSelectedId(buckets[0].id);
    }
  }, [data?.buckets, selectedId]);

  return (
    <WidgetContainer
      title="World News Map"
      widgetId={id}
      exportData={exportRows}
      exportFilename="world_news_map"
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
              <Globe2 className="h-3 w-3 text-amber-300" />
              Source Geography
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

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="chart" />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="No mapped world news sources found."
              detail="Try All regions/topics or refresh the live feeds."
              icon={<MapPin size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div className="grid h-full min-h-0 grid-rows-[1fr_auto] bg-[#060b12] text-white md:grid-cols-[minmax(0,1fr)_260px] md:grid-rows-1">
              <div className="relative min-h-[220px] overflow-hidden border-b border-white/10 md:border-b-0 md:border-r">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(245,158,11,0.14),transparent_26%),radial-gradient(circle_at_75%_35%,rgba(59,130,246,0.12),transparent_28%),linear-gradient(135deg,#07111f,#02040a)]" />
                <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:36px_36px]" />
                <div className="absolute left-[7%] top-[18%] h-[34%] w-[26%] rounded-full bg-white/[0.035] blur-sm" />
                <div className="absolute left-[43%] top-[12%] h-[42%] w-[18%] rounded-full bg-white/[0.035] blur-sm" />
                <div className="absolute left-[62%] top-[48%] h-[30%] w-[24%] rounded-full bg-white/[0.035] blur-sm" />

                <div className="absolute left-3 top-3 z-10 rounded border border-white/10 bg-black/25 px-2 py-1 backdrop-blur">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-200">Live Map</div>
                  <div className="text-lg font-black leading-none text-white">{data?.total_articles || 0}</div>
                  <div className="text-[10px] uppercase text-white/50">fresh articles</div>
                </div>

                {buckets.map((bucket) => {
                  const point = projectMarker(bucket);
                  const size = markerSize(bucket.article_count);
                  const active = selectedBucket?.id === bucket.id;

                  return (
                    <button
                      key={bucket.id}
                      type="button"
                      aria-label={`${bucket.country_name}: ${bucket.article_count} articles`}
                      onClick={() => setSelectedId(bucket.id)}
                      onMouseEnter={() => setSelectedId(bucket.id)}
                      className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    >
                      <span
                        className={`absolute inset-0 rounded-full ${active ? 'animate-ping bg-amber-300/40' : 'bg-blue-300/20'}`}
                        style={{ width: size + 12, height: size + 12, marginLeft: -6, marginTop: -6 }}
                      />
                      <span
                        className={`relative block rounded-full border ${active ? 'border-amber-100 bg-amber-300' : 'border-blue-100 bg-blue-300'} shadow-[0_0_24px_rgba(251,191,36,0.35)]`}
                        style={{ width: size, height: size }}
                      />
                      <span className="absolute left-1/2 top-full mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white shadow group-hover:block">
                        {bucket.country_code} / {bucket.article_count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <aside className="min-h-0 overflow-auto border-white/10 bg-black/25 p-3 scrollbar-hide">
                {selectedBucket && (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
                          {selectedBucket.region}
                        </div>
                        <h3 className="mt-1 text-lg font-black leading-tight text-white">
                          {selectedBucket.country_name}
                        </h3>
                      </div>
                      <div className="rounded border border-white/10 px-2 py-1 text-right">
                        <div className="text-base font-black leading-none text-white">{selectedBucket.article_count}</div>
                        <div className="text-[9px] uppercase text-white/45">articles</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase text-white/55">
                      <div className="border-t border-white/10 pt-2">
                        <div className="font-black text-white">{selectedBucket.source_count}</div>
                        sources
                      </div>
                      <div className="border-t border-white/10 pt-2">
                        <div className="font-black text-white">{formatCategory(selectedBucket.top_category)}</div>
                        top topic
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {selectedBucket.top_sources.map((source) => (
                        <span key={source} className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/65">
                          {source}
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 space-y-3">
                      {selectedBucket.latest_articles.length ? selectedBucket.latest_articles.map((article) => (
                        <article key={article.id} className="border-t border-white/10 pt-3">
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-start gap-2 text-xs font-bold leading-snug text-white hover:text-amber-200"
                          >
                            <span className="line-clamp-3 flex-1">{article.title}</span>
                            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
                          </a>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/45">
                            <span>{formatArticleTime(article.published_at)}</span>
                            <span className="font-bold uppercase text-white/65">{article.source_domain}</span>
                            <a
                              href={article.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto hover:text-amber-200"
                            >
                              Source
                            </a>
                            <a
                              href={article.feed_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 hover:text-emerald-200"
                            >
                              <Rss className="h-2.5 w-2.5" />
                              Feed
                            </a>
                          </div>
                        </article>
                      )) : (
                        <div className="rounded border border-white/10 p-3 text-xs text-white/55">
                          No fresh articles in this geography yet.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const WorldNewsMapWidget = memo(WorldNewsMapWidgetComponent);
export default WorldNewsMapWidget;
