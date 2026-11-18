'use client';

import { useContext, useState } from 'react';
import { Bell } from 'lucide-react';
import { DashboardContext } from '@/contexts/DashboardContext';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';
import { parseAlertTime } from '@/lib/alertTime';
import { formatTimestamp } from '@/lib/formatDate';
import type { AlertActivity, AlertActivitySource } from '@/lib/alertActivity';
import { parseWatchlistSymbols } from './WatchlistWidget';
import { usePredictionMarketWatchlist } from './prediction-market-ui/PredictionMarketWatchlist';

const SOURCE_LABELS = {
  price: 'Price alerts',
  saved_screen: 'Saved screens',
  prediction_market: 'Prediction markets',
  insider: 'Insider activity',
} as const satisfies Record<AlertActivitySource, string>;
const DAY_MS = 86_400_000;
const filterClass = 'min-h-9 w-full min-w-0 rounded border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]';

export function useAlertRelevance() {
  const dashboard = useContext(DashboardContext);
  const { watchlist: markets } = usePredictionMarketWatchlist();
  const followedSymbols = new Set<string>();
  const priceSymbols = new Set<string>();
  const screens = new Set<string>();

  for (const board of dashboard?.state.dashboards ?? []) {
    for (const tab of board.tabs) {
      for (const { type, config } of tab.widgets) {
        if (type === 'watchlist') {
          for (const symbol of parseWatchlistSymbols(config)) followedSymbols.add(symbol);
        } else if (type === 'price_alerts' && Array.isArray(config.alerts)) {
          for (const rule of config.alerts) {
            if (!rule || typeof rule !== 'object' || !('symbol' in rule) || typeof rule.symbol !== 'string') continue;
            const symbol = normalizeTickerSymbol(rule.symbol);
            if (symbol) priceSymbols.add(symbol);
          }
        } else if (type === 'screener' && Array.isArray(config.savedScreens)) {
          for (const screen of config.savedScreens) {
            if (screen && typeof screen === 'object' && 'id' in screen && typeof screen.id === 'string') screens.add(screen.id);
          }
        }
      }
    }
  }

  // Insider rows expose no saved-rule match. A price or screen rule is not an insider subscription.
  function followsInsider(symbol: string | undefined) {
    const ticker = normalizeTickerSymbol(symbol);
    return ticker !== null && followedSymbols.has(ticker);
  }

  return {
    configured: Boolean(followedSymbols.size || priceSymbols.size || screens.size || markets.size),
    followsInsider,
    matches(item: AlertActivity) {
      if (item.source === 'insider') return followsInsider(item.symbol);
      const symbol = normalizeTickerSymbol(item.symbol);
      if (symbol && (followedSymbols.has(symbol) || priceSymbols.has(symbol))) return true;
      if (item.source === 'prediction_market') {
        const market = /^prediction:(.+?):\d+h:/.exec(item.id)?.[1];
        return market !== undefined && markets.has(market);
      }
      if (item.source === 'saved_screen') {
        const screenId = /^saved-screen:([^:]+):/.exec(item.id)?.[1];
        return screenId !== undefined && screens.has(screenId);
      }
      return false;
    },
  };
}

function rowTitle(item: AlertActivity) {
  // Retained prediction observations store the market question before the movement evidence.
  return item.source === 'prediction_market' && item.title.endsWith(' probability movement')
    ? item.detail?.split(' · ')[0] || item.title
    : item.title;
}

function AlertInboxRow({ item, time, now, onOpen }: {
  readonly item: AlertActivity;
  readonly time: number | null;
  readonly now: number;
  readonly onOpen: (item: AlertActivity) => void;
}) {
  const symbol = normalizeTickerSymbol(item.symbol);
  const title = rowTitle(item);
  return (
    <li className={`px-3 py-1 ${!item.read ? 'bg-[var(--color-state-bg)]' : ''}`}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={symbol ? `Open ${symbol} from ${title}` : `${item.read ? 'Open' : 'Mark'} ${title}${item.read ? '' : ' read'}`}
        className="min-h-11 w-full rounded px-2 py-1.5 text-left hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words text-sm font-medium text-[var(--text-primary)]">{title}</span>
          {!item.read && <span className="shrink-0 text-xs text-[var(--color-accent-primary)]">Unread</span>}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-muted)]">
          {symbol && <span className="font-medium text-[var(--text-secondary)]">{symbol}</span>}
          {time === null ? 'Time unavailable' : (
            <time dateTime={new Date(time).toISOString()}>{formatTimestamp(time)}{time > now && ' (future timestamp)'}</time>
          )}
        </span>
      </button>
      {item.detail && (
        <details className="px-2 pb-0.5 text-xs text-[var(--text-secondary)]">
          <summary tabIndex={0} aria-label={`Details for ${title}`} className="w-fit cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]">Details</summary>
          <p className="break-words">{item.detail}</p>
          <p className="pb-1 text-[var(--text-muted)]">{item.serverBacked ? 'Server record. Desktop delivery is not confirmed.' : 'Observed in this browser.'}</p>
        </details>
      )}
    </li>
  );
}

export function AlertInbox({ activity, relevance, unreadOnly, isLoading, isError, onOpen }: {
  readonly activity: readonly AlertActivity[];
  readonly relevance: ReturnType<typeof useAlertRelevance>;
  readonly unreadOnly: boolean;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onOpen: (item: AlertActivity) => void;
}) {
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [source, setSource] = useState('all');
  const [range, setRange] = useState('all');
  const [search, setSearch] = useState('');
  const scope = relevance.configured ? selectedScope ?? 'followed' : 'all';
  const query = search.trim().toLowerCase();
  const now = Date.now();
  const groups = new Map<AlertActivitySource, { item: AlertActivity; time: number | null }[]>();
  const rows = activity.map((item) => ({ item, time: parseAlertTime(item.triggerTime) }))
    .sort((left, right) => (right.time ?? -Infinity) - (left.time ?? -Infinity));

  for (const row of rows) {
    const { item, time } = row;
    if (unreadOnly && item.read) continue;
    if (scope === 'followed' && !relevance.matches(item)) continue;
    if (source !== 'all' && item.source !== source) continue;
    if (range !== 'all' && (time === null || time > now || time < now - Number(range) * DAY_MS)) continue;
    if (query && ![item.symbol, item.title, item.detail].some((value) => value?.toLowerCase().includes(query))) continue;
    const group = groups.get(item.source) ?? [];
    group.push(row);
    groups.set(item.source, group);
  }
  const filtered = groups.size === 0 && (scope === 'followed' || source !== 'all' || range !== 'all' || query !== '');

  return (
    <>
      <div className="grid shrink-0 grid-cols-2 gap-x-2 gap-y-1.5 border-b border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
        <label className="min-w-0 space-y-0.5">Scope
          <select className={filterClass} aria-label="Alert scope" value={scope} onChange={(event) => setSelectedScope(event.target.value)}>
            {relevance.configured && <option value="followed">Followed topics</option>}
            <option value="all">All topics</option>
          </select>
        </label>
        <label className="min-w-0 space-y-0.5">Source
          <select className={filterClass} aria-label="Alert source" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-0.5">Time range
          <select className={filterClass} value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="all">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
        <label className="min-w-0 space-y-0.5">Symbol or topic
          <input type="search" className={filterClass} placeholder="Search alerts" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      <div role="region" aria-label="Alert activity list" tabIndex={0} className="min-h-24 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]">
        {groups.size > 0 ? Array.from(groups, ([key, group]) => (
          <section key={key}>
            <h4 className="border-y border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-1.5 text-xs font-medium text-[var(--text-secondary)]">{SOURCE_LABELS[key]}</h4>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {group.map(({ item, time }) => <AlertInboxRow key={item.id} item={item} time={time} now={now} onOpen={onOpen} />)}
            </ul>
          </section>
        )) : isLoading ? (
          <p role="status" className="p-4 text-sm text-[var(--text-secondary)]">Loading insider alerts…</p>
        ) : (!isError || activity.length > 0) && (
          <div className="flex min-h-28 flex-col items-center justify-center p-3 text-center text-[var(--text-muted)]">
            <Bell aria-hidden="true" size={22} className="mb-2" />
            <p className="text-sm">{filtered ? 'No matching activity' : 'No alert activity'}</p>
            {filtered ? (
              <button type="button" className="min-h-9 rounded px-2 text-xs text-[var(--color-accent-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]" onClick={() => { setSelectedScope('all'); setSource('all'); setRange('all'); setSearch(''); }}>Clear filters</button>
            ) : <p className="mt-1 text-xs">No observed {unreadOnly ? 'unread ' : ''}triggers.</p>}
          </div>
        )}
      </div>
    </>
  );
}
