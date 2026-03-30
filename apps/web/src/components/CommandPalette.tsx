'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Bitcoin,
  ChartCandlestick,
  Coins,
  Command as CommandIcon,
  ExternalLink,
  Globe2,
  LayoutGrid,
  Newspaper,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';

import { searchTickers, type SearchTickerResult } from '@/lib/api';
import {
  buildTickerPaletteSections,
  readCommandPaletteRecents,
  saveRecentSearch,
  writeCommandPaletteRecents,
  type CommandPaletteActionItem,
  type RecentSearchEntry,
} from '@/lib/commandPalette';
import { useDashboard } from '@/contexts/DashboardContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getTickerIcon(type: SearchTickerResult['type']) {
  switch (type) {
    case 'vn_stock':
      return <span className="text-sm">VN</span>;
    case 'crypto':
      return <Bitcoin className="h-4 w-4 text-amber-300" />;
    case 'index':
      return <Globe2 className="h-4 w-4 text-cyan-300" />;
    case 'us_stock':
      return <TrendingUp className="h-4 w-4 text-emerald-300" />;
    default:
      return <Search className="h-4 w-4" />;
  }
}

function highlightMatch(text: string, query: string): Array<string | ReactNode> {
  const trimmed = query.trim();
  if (!trimmed) return [text];

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'ig');
  return text.split(regex).filter(Boolean).map((part, index) => (
    part.toLowerCase() === trimmed.toLowerCase()
      ? <mark key={`${part}-${index}`} className="rounded bg-blue-500/20 px-0.5 text-blue-100">{part}</mark>
      : part
  ));
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>([]);
  const {
    state,
    setActiveDashboard,
    addWidget,
  } = useDashboard();
  const { setGlobalSymbol } = useWidgetGroups();

  useEffect(() => {
    if (open) {
      setRecentSearches(readCommandPaletteRecents());
    }
  }, [open]);

  const trimmedSearch = search.trim();
  const tickerQuery = useQuery({
    queryKey: ['command-palette-tickers', trimmedSearch],
    queryFn: () => searchTickers(trimmedSearch, { limit: 12 }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const commandActions = useMemo(() => {
    const actions = new Map<string, () => void>();
    const items: CommandPaletteActionItem[] = [];

    const defaultDashboard = state.dashboards.find((dashboard) => dashboard.isDefault) ?? state.dashboards[0];
    if (defaultDashboard) {
      const item: CommandPaletteActionItem = {
        id: `workspace:${defaultDashboard.id}`,
        type: 'workspace',
        label: `Open ${defaultDashboard.name}`,
        description: 'Default workspace',
      };
      actions.set(item.id, () => {
        setActiveDashboard(defaultDashboard.id);
        onOpenChange(false);
      });
      items.push(item);
    }

    state.dashboards
      .filter((dashboard) => !dashboard.isDefault)
      .forEach((dashboard) => {
        const item: CommandPaletteActionItem = {
          id: `workspace:${dashboard.id}`,
          type: 'workspace',
          label: `Switch to ${dashboard.name}`,
          description: 'Workspace',
        };
        actions.set(item.id, () => {
          setActiveDashboard(dashboard.id);
          onOpenChange(false);
        });
        items.push(item);
      });

    const settingsItem: CommandPaletteActionItem = {
      id: 'command:settings',
      type: 'command',
      label: 'Open Settings',
      description: 'Navigate to app settings',
    };
    actions.set(settingsItem.id, () => {
      router.push('/settings');
      onOpenChange(false);
    });
    items.push(settingsItem);

    const quantItem: CommandPaletteActionItem = {
      id: 'command:add-quant-summary',
      type: 'command',
      label: 'Add Quant Summary Widget',
      description: 'Pin a quant overview to the active tab',
    };
    actions.set(quantItem.id, () => {
      if (state.activeDashboardId && state.activeTabId) {
        addWidget(state.activeDashboardId, state.activeTabId, {
          type: 'quant_summary',
          tabId: state.activeTabId,
          layout: { x: 0, y: Infinity, w: 10, h: 8 },
        });
      }
      onOpenChange(false);
    });
    items.push(quantItem);

    const marketNewsItem: CommandPaletteActionItem = {
      id: 'command:add-market-news',
      type: 'command',
      label: 'Add Market News Widget',
      description: 'Fill the News & Events tab with market context',
    };
    actions.set(marketNewsItem.id, () => {
      if (state.activeDashboardId && state.activeTabId) {
        addWidget(state.activeDashboardId, state.activeTabId, {
          type: 'market_news',
          tabId: state.activeTabId,
          layout: { x: 0, y: Infinity, w: 12, h: 8 },
        });
      }
      onOpenChange(false);
    });
    items.push(marketNewsItem);

    const tradingViewItem: CommandPaletteActionItem = {
      id: 'command:add-tradingview',
      type: 'command',
      label: 'Add TradingView Chart Widget',
      description: 'Open a global asset chart widget on the current tab',
    };
    actions.set(tradingViewItem.id, () => {
      if (state.activeDashboardId && state.activeTabId) {
        addWidget(state.activeDashboardId, state.activeTabId, {
          type: 'tradingview_chart',
          tabId: state.activeTabId,
          config: { symbol: 'NASDAQ:AAPL' },
          layout: { x: 0, y: Infinity, w: 10, h: 8 },
        });
      }
      onOpenChange(false);
    });
    items.push(tradingViewItem);

    return { items, actions };
  }, [addWidget, onOpenChange, router, setActiveDashboard, state.activeDashboardId, state.activeTabId, state.dashboards]);

  const sections = useMemo(
    () => buildTickerPaletteSections(trimmedSearch, recentSearches, tickerQuery.data?.results || [], commandActions.items),
    [commandActions.items, recentSearches, tickerQuery.data?.results, trimmedSearch],
  );

  const saveRecent = (item: SearchTickerResult) => {
    const next = saveRecentSearch(recentSearches, {
      symbol: item.symbol,
      label: item.name,
      type: item.type,
      exchange: item.exchange,
      tvSymbol: item.tv_symbol,
    });
    setRecentSearches(next);
    writeCommandPaletteRecents(next);
  };

  const handleTickerSelect = (item: SearchTickerResult) => {
    saveRecent(item);

    if (item.type === 'vn_stock') {
      setGlobalSymbol(item.symbol);
      onOpenChange(false);
      return;
    }

    if (state.activeDashboardId && state.activeTabId) {
      addWidget(state.activeDashboardId, state.activeTabId, {
        type: 'tradingview_chart',
        tabId: state.activeTabId,
        config: { symbol: item.tv_symbol || item.symbol },
        layout: { x: 0, y: Infinity, w: 10, h: 8 },
      });
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-[rgba(2,6,23,0.72)] p-4 pt-[12vh]">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl">
        <Command className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-4 py-3">
            <CommandIcon className="h-5 w-5 text-[var(--text-muted)]" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search tickers, crypto, indices, or commands..."
              aria-label="Command palette search"
              autoFocus
              className="h-11 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              aria-label="Close command palette"
            >
              <X size={16} />
            </button>
          </div>

          <Command.List className="max-h-[480px] overflow-y-auto px-2 py-2 scrollbar-hide">
            <Command.Empty className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--text-muted)]">
              <Search className="h-8 w-8 opacity-30" />
              <span>No results found for "{trimmedSearch}"</span>
            </Command.Empty>

            {sections.map((section) => (
              <Command.Group key={section.key} heading={section.label}>
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  {section.label}
                </div>
                {section.items.map((item) => {
                  const tickerResult = (tickerQuery.data?.results || []).find(
                    (result) => result.symbol === item.symbol && result.type === item.type,
                  );
                  const isTicker = item.type !== 'command' && item.type !== 'workspace';
                  const icon = isTicker
                    ? getTickerIcon(item.type as SearchTickerResult['type'])
                    : item.type === 'workspace'
                      ? <LayoutGrid className="h-4 w-4 text-cyan-300" />
                      : item.id.includes('settings')
                        ? <Settings className="h-4 w-4 text-amber-300" />
                        : item.id.includes('market-news')
                          ? <Newspaper className="h-4 w-4 text-emerald-300" />
                          : item.id.includes('tradingview')
                            ? <ChartCandlestick className="h-4 w-4 text-violet-300" />
                            : item.id.includes('quant')
                              ? <Sparkles className="h-4 w-4 text-indigo-300" />
                              : <ArrowRightLeft className="h-4 w-4 text-[var(--text-muted)]" />;

                  return (
                    <Command.Item
                      key={item.id}
                      value={`${item.label} ${item.description || ''} ${item.symbol || ''}`}
                      onSelect={() => {
                        if (isTicker && item.symbol) {
                          handleTickerSelect(
                            tickerResult || {
                              symbol: item.symbol,
                              name: item.description || item.label,
                              type: item.type as SearchTickerResult['type'],
                              exchange: item.exchange,
                              tv_symbol: item.tvSymbol,
                            },
                          );
                          return;
                        }
                        commandActions.actions.get(item.id)?.();
                      }}
                      className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-[var(--text-secondary)] outline-none transition-colors aria-selected:bg-blue-600/10 aria-selected:text-blue-300"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                        {icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {highlightMatch(item.label, trimmedSearch)}
                        </div>
                        {item.description ? (
                          <div className="truncate text-xs text-[var(--text-muted)]">
                            {highlightMatch(item.description, trimmedSearch)}
                          </div>
                        ) : null}
                      </div>
                      {item.exchange ? (
                        <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                          {item.exchange}
                        </span>
                      ) : null}
                      {item.type === 'crypto' || item.type === 'index' || item.type === 'us_stock' ? (
                        <ExternalLink className="h-3.5 w-3.5 opacity-60 transition-opacity group-aria-selected:opacity-100" />
                      ) : null}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>

          <div className="flex items-center justify-between border-t border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-4 py-2 text-[10px] text-[var(--text-muted)]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5">Ctrl+K</kbd>
                <span>Open</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5">↑↓</kbd>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5">Enter</kbd>
                <span>Select</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5">Esc</kbd>
                <span>Close</span>
              </div>
            </div>
            <span className="font-mono">VNIBB Discover</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

export default CommandPalette;
