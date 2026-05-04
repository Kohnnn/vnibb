'use client';

import { memo, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe2, Layers3, MapPin, Radio, Rss, X } from 'lucide-react';
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
type MapView = 'global' | 'america' | 'europe' | 'asia' | 'africa';

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

const MAP_VIEWS: Array<{ value: MapView; label: string; viewBox: string }> = [
  { value: 'global', label: 'Global', viewBox: '0 22 1000 436' },
  { value: 'america', label: 'Americas', viewBox: '40 58 400 420' },
  { value: 'europe', label: 'Europe', viewBox: '410 70 255 210' },
  { value: 'asia', label: 'Asia', viewBox: '540 70 390 330' },
  { value: 'africa', label: 'Africa', viewBox: '430 150 300 290' },
];

const WORLD_LAND_PATHS: Array<{ id: string; label: string; d: string }> = [
  {
    id: 'greenland',
    label: 'Greenland',
    d: 'M318 65 C345 44 385 48 407 76 C391 102 355 116 321 101 C304 90 302 76 318 65 Z',
  },
  {
    id: 'north-america',
    label: 'North America',
    d: 'M82 151 C105 107 154 78 221 80 C260 84 300 98 329 129 C357 161 339 201 304 217 C286 225 271 241 266 263 C260 286 235 299 214 286 C199 277 184 256 164 255 C129 253 105 229 98 198 C94 180 75 174 82 151 Z',
  },
  {
    id: 'central-america',
    label: 'Central America',
    d: 'M216 287 C237 292 258 302 280 319 C301 336 323 335 343 350 C330 363 300 358 280 344 C258 329 237 320 213 315 C201 306 204 294 216 287 Z',
  },
  {
    id: 'south-america',
    label: 'South America',
    d: 'M326 335 C355 354 376 382 376 419 C376 452 353 486 323 496 C309 468 292 436 286 400 C281 370 292 346 326 335 Z',
  },
  {
    id: 'europe',
    label: 'Europe',
    d: 'M458 146 C486 119 540 119 574 142 C595 156 596 184 576 202 C550 226 505 214 478 201 C449 187 437 166 458 146 Z',
  },
  {
    id: 'africa',
    label: 'Africa',
    d: 'M505 205 C542 184 597 197 625 235 C655 277 642 339 606 385 C574 423 528 397 515 352 C506 318 481 299 485 262 C487 238 491 216 505 205 Z',
  },
  {
    id: 'middle-east',
    label: 'Middle East',
    d: 'M598 194 C630 181 672 191 690 216 C672 236 628 236 602 219 C590 211 587 200 598 194 Z',
  },
  {
    id: 'asia',
    label: 'Asia',
    d: 'M596 134 C656 91 768 99 835 135 C888 164 907 218 867 258 C828 298 749 297 705 270 C676 252 643 256 621 236 C599 216 577 185 596 134 Z',
  },
  {
    id: 'southeast-asia',
    label: 'Southeast Asia',
    d: 'M704 278 C725 281 746 294 752 316 C733 329 702 320 690 302 C684 292 691 280 704 278 Z M771 302 C788 305 810 315 823 334 C806 344 780 335 767 319 C759 311 761 304 771 302 Z',
  },
  {
    id: 'japan',
    label: 'Japan',
    d: 'M841 200 C858 209 864 230 856 249 C838 240 829 217 841 200 Z',
  },
  {
    id: 'australia',
    label: 'Australia',
    d: 'M754 360 C793 331 856 337 885 373 C864 410 801 421 760 393 C746 383 744 371 754 360 Z',
  },
  {
    id: 'new-zealand',
    label: 'New Zealand',
    d: 'M901 407 C916 414 927 430 924 446 C907 440 894 423 901 407 Z',
  },
  {
    id: 'antarctica',
    label: 'Antarctica',
    d: 'M110 479 C252 456 438 470 571 461 C724 452 852 463 948 480 L948 500 L110 500 Z',
  },
];

const LONGITUDE_LINES = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
const LATITUDE_LINES = [-60, -30, 0, 30, 60];
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
      ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30'
      : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
  }`;
}

function mapViewClass(active: boolean) {
  return `rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] transition-colors ${
    active
      ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
      : 'border-white/10 bg-black/20 text-white/50 hover:border-white/25 hover:text-white'
  }`;
}

function coordinateX(longitude: number) {
  return ((longitude + 180) / 360) * 1000;
}

function coordinateY(latitude: number) {
  return ((90 - latitude) / 180) * 500;
}

function projectMarker(bucket: WorldNewsMapBucket) {
  return {
    x: coordinateX(bucket.longitude),
    y: coordinateY(bucket.latitude),
  };
}

function markerRadius(articleCount: number) {
  if (articleCount >= 30) return 13;
  if (articleCount >= 15) return 11;
  if (articleCount >= 5) return 9;
  if (articleCount > 0) return 7;
  return 5;
}

function markerTone(bucket: WorldNewsMapBucket, active: boolean) {
  if (active) return { fill: '#fbbf24', stroke: '#fffbeb', glow: 'rgba(251,191,36,0.7)' };
  if (bucket.article_count === 0) return { fill: '#64748b', stroke: '#cbd5e1', glow: 'rgba(148,163,184,0.35)' };
  if (bucket.top_category === 'markets') return { fill: '#38bdf8', stroke: '#e0f2fe', glow: 'rgba(56,189,248,0.55)' };
  if (bucket.top_category === 'technology') return { fill: '#a78bfa', stroke: '#ede9fe', glow: 'rgba(167,139,250,0.55)' };
  if (bucket.top_category === 'business') return { fill: '#34d399', stroke: '#d1fae5', glow: 'rgba(52,211,153,0.55)' };
  return { fill: '#fb7185', stroke: '#ffe4e6', glow: 'rgba(251,113,133,0.55)' };
}

function formatCategory(value: string | null) {
  return value ? value.replace(/_/g, ' ') : 'No active topic';
}

function formatArticleTime(value: string | null) {
  const formatted = formatTimestamp(value);
  return formatted === '-' ? 'Live feed' : formatted;
}

function isValidCustomFeedUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
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
  const [mapView, setMapView] = useState<MapView>('global');
  const [customFeed, setCustomFeed] = useState<{ url: string; name: string } | null>(() => getInitialCustomFeed(config));
  const [customUrlInput, setCustomUrlInput] = useState(() => getInitialCustomFeed(config)?.url || '');
  const [customNameInput, setCustomNameInput] = useState(() => getInitialCustomFeed(config)?.name || '');
  const [customError, setCustomError] = useState<string | null>(null);
  const limit = getNumberConfig(config, 'limit', 160);
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
    queryKey: [
      'world-news-map',
      region,
      category,
      limit,
      freshnessHours,
      customFeed?.url || '',
      customFeed?.name || '',
    ],
    queryFn: ({ signal }) => getWorldNewsMap({
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

  const buckets = data?.buckets || [];
  const activeBuckets = buckets.filter((bucket) => bucket.article_count > 0);
  const hasData = buckets.length > 0;
  const selectedBucket = buckets.find((bucket) => bucket.id === selectedId) || activeBuckets[0] || buckets[0];
  const currentView = MAP_VIEWS.find((view) => view.value === mapView) || MAP_VIEWS[0];
  const isFallback = Boolean(error && hasData);
  const sourceNote = data
    ? `${data.source_count} sources / ${data.feed_count} feeds${customFeed ? ' / custom RSS' : ''}${data.failed_feed_count ? ` / ${data.failed_feed_count} failed` : ''}`
    : 'Live RSS/Atom geography';
  const exportRows = buckets.map((bucket) => ({
    ...bucket,
    top_sources: bucket.top_sources.join(', '),
    latest_articles: bucket.latest_articles.map((article) => article.url).join(', '),
  }));

  useEffect(() => {
    const nextBuckets = data?.buckets || [];
    if (!nextBuckets.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !nextBuckets.some((bucket) => bucket.id === selectedId)) {
      const nextActiveBuckets = nextBuckets.filter((bucket) => bucket.article_count > 0);
      setSelectedId((nextActiveBuckets[0] || nextBuckets[0]).id);
    }
  }, [data?.buckets, selectedId]);

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

  function handleMarkerKeyDown(event: KeyboardEvent<SVGGElement>, bucketId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelectedId(bucketId);
  }

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
              Live Coverage Map
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
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-amber-400/50"
            />
            <input
              aria-label="Custom RSS source name"
              value={customNameInput}
              onChange={(event) => setCustomNameInput(event.target.value)}
              placeholder="Source name"
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-amber-400/50"
            />
            <div className="flex gap-1">
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 text-[10px] font-black uppercase text-amber-100 hover:bg-amber-400/20"
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
            <div className="mt-1 truncate text-[10px] text-amber-200/80">
              Custom RSS active: {customFeed.name || customFeed.url}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="chart" />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="No mapped world news sources found."
              detail="Try All regions/topics, add a custom RSS feed, or refresh the live feeds."
              icon={<MapPin size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div className="grid h-full min-h-0 grid-rows-[1fr_auto] bg-[#030711] text-white md:grid-cols-[minmax(0,1fr)_280px] md:grid-rows-1">
              <div className="relative min-h-[260px] overflow-hidden border-b border-white/10 md:border-b-0 md:border-r">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(245,158,11,0.18),transparent_24%),radial-gradient(circle_at_75%_36%,rgba(56,189,248,0.14),transparent_28%),linear-gradient(135deg,#081425,#02050d)]" />
                <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:34px_34px]" />

                <div className="absolute left-3 top-3 z-10 rounded border border-white/10 bg-black/35 px-2 py-1 backdrop-blur">
                  <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.18em] text-amber-200">
                    <Layers3 className="h-3 w-3" />
                    Live Map
                  </div>
                  <div className="text-lg font-black leading-none text-white">{data?.total_articles || 0}</div>
                  <div className="text-[10px] uppercase text-white/50">deduped articles</div>
                </div>

                <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-1">
                  {MAP_VIEWS.map((view) => (
                    <button
                      key={view.value}
                      type="button"
                      onClick={() => setMapView(view.value)}
                      className={mapViewClass(mapView === view.value)}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>

                <svg
                  role="img"
                  aria-label="World news activity map"
                  viewBox={currentView.viewBox}
                  preserveAspectRatio="xMidYMid meet"
                  className="relative z-[1] h-full w-full"
                >
                  <defs>
                    <linearGradient id="world-news-ocean" x1="0" x2="1" y1="0" y2="1">
                      <stop offset="0%" stopColor="#071a31" />
                      <stop offset="54%" stopColor="#06101f" />
                      <stop offset="100%" stopColor="#02040a" />
                    </linearGradient>
                    <filter id="world-news-marker-glow" x="-80%" y="-80%" width="260%" height="260%">
                      <feGaussianBlur stdDeviation="5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <rect x="0" y="0" width="1000" height="500" fill="url(#world-news-ocean)" />
                  <g opacity="0.26">
                    {LONGITUDE_LINES.map((longitude) => {
                      const x = coordinateX(longitude);
                      return <line key={longitude} x1={x} x2={x} y1="20" y2="480" stroke="#93c5fd" strokeWidth="0.7" />;
                    })}
                    {LATITUDE_LINES.map((latitude) => {
                      const y = coordinateY(latitude);
                      return <line key={latitude} x1="35" x2="965" y1={y} y2={y} stroke="#93c5fd" strokeWidth="0.7" />;
                    })}
                    <line x1="35" x2="965" y1={coordinateY(0)} y2={coordinateY(0)} stroke="#fbbf24" strokeWidth="0.9" opacity="0.55" />
                  </g>

                  <g>
                    {WORLD_LAND_PATHS.map((shape) => (
                      <path
                        key={shape.id}
                        d={shape.d}
                        fill={shape.id === 'antarctica' ? '#111827' : '#162236'}
                        stroke="#334155"
                        strokeWidth="1.4"
                        opacity={shape.id === 'antarctica' ? 0.65 : 0.96}
                      >
                        <title>{shape.label}</title>
                      </path>
                    ))}
                  </g>

                  <g opacity="0.45">
                    <text x="515" y="154" fill="#cbd5e1" fontSize="12" fontWeight="800" letterSpacing="2">EUROPE</text>
                    <text x="675" y="178" fill="#cbd5e1" fontSize="12" fontWeight="800" letterSpacing="2">ASIA</text>
                    <text x="525" y="294" fill="#cbd5e1" fontSize="12" fontWeight="800" letterSpacing="2">AFRICA</text>
                    <text x="145" y="176" fill="#cbd5e1" fontSize="12" fontWeight="800" letterSpacing="2">N. AMERICA</text>
                    <text x="304" y="414" fill="#cbd5e1" fontSize="12" fontWeight="800" letterSpacing="2">S. AMERICA</text>
                  </g>

                  <g>
                    {buckets.map((bucket) => {
                      const point = projectMarker(bucket);
                      const radius = markerRadius(bucket.article_count);
                      const active = selectedBucket?.id === bucket.id;
                      const tone = markerTone(bucket, active);

                      return (
                        <g
                          key={bucket.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${bucket.country_name}: ${bucket.article_count} articles`}
                          transform={`translate(${point.x} ${point.y})`}
                          className="cursor-pointer outline-none"
                          onClick={() => setSelectedId(bucket.id)}
                          onMouseEnter={() => setSelectedId(bucket.id)}
                          onKeyDown={(event) => handleMarkerKeyDown(event, bucket.id)}
                        >
                          <title>{`${bucket.country_name}: ${bucket.article_count} articles`}</title>
                          <circle
                            r={radius + 12}
                            fill={tone.fill}
                            opacity={active ? 0.2 : 0.1}
                            className={active ? 'animate-ping' : ''}
                          />
                          <circle
                            r={radius + 5}
                            fill="none"
                            stroke={tone.fill}
                            strokeWidth="1.2"
                            opacity="0.45"
                          />
                          <circle
                            r={radius}
                            fill={tone.fill}
                            stroke={tone.stroke}
                            strokeWidth="2"
                            filter="url(#world-news-marker-glow)"
                            style={{ filter: `drop-shadow(0 0 10px ${tone.glow})` }}
                          />
                          {bucket.article_count > 0 && (
                            <text
                              x="0"
                              y={radius + 15}
                              textAnchor="middle"
                              fill="#f8fafc"
                              fontSize="10"
                              fontWeight="900"
                              paintOrder="stroke"
                              stroke="#020617"
                              strokeWidth="3"
                            >
                              {bucket.country_code} {bucket.article_count}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>

                <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] uppercase text-white/55 backdrop-blur">
                  <span className="font-black text-white/75">Marker color</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" /> Markets</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Business</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-400" /> Tech</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" /> Geo</span>
                  <span className="ml-auto">Reference style: graticule + live markers</span>
                </div>
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
                          No fresh articles in this geography yet. The marker stays visible so source coverage is transparent.
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
