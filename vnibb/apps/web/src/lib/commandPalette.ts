import type { SearchTickerResult } from '@/lib/api';

export type CommandPaletteItemType = SearchTickerResult['type'] | 'command' | 'workspace';

export interface CommandPaletteActionItem {
  id: string;
  type: CommandPaletteItemType;
  label: string;
  description?: string;
  symbol?: string;
  exchange?: string | null;
  tvSymbol?: string | null;
}

export interface CommandPaletteSection {
  key: string;
  label: string;
  items: CommandPaletteActionItem[];
}

export interface RecentSearchEntry {
  symbol: string;
  label: string;
  type: SearchTickerResult['type'];
  exchange?: string | null;
  tvSymbol?: string | null;
}

export const COMMAND_PALETTE_RECENTS_KEY = 'vnibb-command-palette-recents';

function includesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

function scoreItem(query: string, item: CommandPaletteActionItem): number {
  if (!query) return 100;
  const label = item.label.toLowerCase();
  const symbol = (item.symbol || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  const q = query.toLowerCase();

  if (symbol === q || label === q) return 0;
  if (symbol.startsWith(q)) return 1;
  if (label.startsWith(q)) return 2;
  if (description.startsWith(q)) return 3;
  if (includesQuery(symbol, q)) return 4;
  if (includesQuery(label, q)) return 5;
  if (includesQuery(description, q)) return 6;
  return 99;
}

export function rankCommandPaletteItems(
  query: string,
  items: CommandPaletteActionItem[],
): CommandPaletteActionItem[] {
  const trimmed = query.trim();
  return items
    .map((item) => ({ item, score: scoreItem(trimmed, item) }))
    .filter(({ score }) => !trimmed || score < 99)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.item.label.localeCompare(right.item.label);
    })
    .map(({ item }) => item);
}

export function buildTickerPaletteSections(
  query: string,
  recents: RecentSearchEntry[],
  tickerResults: SearchTickerResult[],
  commandItems: CommandPaletteActionItem[],
): CommandPaletteSection[] {
  const tickerItems: CommandPaletteActionItem[] = tickerResults.map((item) => ({
    id: `${item.type}:${item.symbol}`,
    type: item.type,
    label: item.symbol,
    description:
      item.type === 'vn_stock'
        ? item.name
        : `${item.name} • Opens TradingView in Global Markets`,
    symbol: item.symbol,
    exchange: item.exchange,
    tvSymbol: item.tv_symbol,
  }));

  const recentItems: CommandPaletteActionItem[] = recents.map((item) => ({
    id: `recent:${item.type}:${item.symbol}`,
    type: item.type,
    label: item.symbol,
    description: item.label,
    symbol: item.symbol,
    exchange: item.exchange,
    tvSymbol: item.tvSymbol,
  }));

  const filteredRecents = rankCommandPaletteItems(query, recentItems).slice(0, 5);
  const filteredTickers = rankCommandPaletteItems(query, tickerItems).filter(
    (item) => !filteredRecents.some((recent) => recent.symbol === item.symbol && recent.type === item.type),
  );
  const filteredCommands = rankCommandPaletteItems(query, commandItems);

  const byType = (type: CommandPaletteItemType) => filteredTickers.filter((item) => item.type === type);

  const sections: CommandPaletteSection[] = [];
  if (filteredRecents.length) sections.push({ key: 'recent', label: 'Recent', items: filteredRecents });
  if (byType('vn_stock').length) sections.push({ key: 'stocks', label: 'VN Stocks', items: byType('vn_stock') });
  if (byType('crypto').length) sections.push({ key: 'crypto', label: 'Crypto', items: byType('crypto') });
  if (byType('index').length || byType('us_stock').length) {
    sections.push({
      key: 'global',
      label: 'Global & Macro',
      items: [...byType('index'), ...byType('us_stock')],
    });
  }
  if (filteredCommands.length) sections.push({ key: 'commands', label: 'Commands', items: filteredCommands });

  return sections;
}

export function readCommandPaletteRecents(): RecentSearchEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COMMAND_PALETTE_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearchEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCommandPaletteRecents(entries: RecentSearchEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COMMAND_PALETTE_RECENTS_KEY, JSON.stringify(entries.slice(0, 8)));
  } catch {
    // ignore persistence errors
  }
}

export function saveRecentSearch(
  currentEntries: RecentSearchEntry[],
  item: RecentSearchEntry,
): RecentSearchEntry[] {
  const next = [item, ...currentEntries.filter((entry) => !(entry.symbol === item.symbol && entry.type === item.type))];
  return next.slice(0, 8);
}
