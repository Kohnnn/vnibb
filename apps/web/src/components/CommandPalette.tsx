'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Bitcoin,
  ChartCandlestick,
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
  type CommandPaletteSection,
  type RecentSearchEntry,
} from '@/lib/commandPalette';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { useDashboard } from '@/contexts/DashboardContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { cn } from '@/lib/utils';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RenderItem extends CommandPaletteActionItem {
  sectionKey: string;
}

const GLOBAL_MARKETS_DASHBOARD_NAME = 'Global Markets';
const GLOBAL_MARKETS_TAB_NAME = 'Global Markets';

function getTickerIcon(type: SearchTickerResult['type']): ReactNode {
  switch (type) {
    case 'vn_stock':
      return <span className="text-[11px] font-black uppercase tracking-widest text-sky-300">VN</span>;
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

function getCommandIcon(item: CommandPaletteActionItem): ReactNode {
  if (item.type === 'workspace') return <LayoutGrid className="h-4 w-4 text-cyan-300" />;
  if (item.id.includes('settings')) return <Settings className="h-4 w-4 text-amber-300" />;
  if (item.id.includes('market-news')) return <Newspaper className="h-4 w-4 text-emerald-300" />;
  if (item.id.includes('tradingview')) return <ChartCandlestick className="h-4 w-4 text-violet-300" />;
  if (item.id.includes('quant')) return <Sparkles className="h-4 w-4 text-indigo-300" />;
  return <ArrowRightLeft className="h-4 w-4 text-[var(--text-muted)]" />;
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const {
    state,
    activeDashboard,
    activeTab,
    setActiveDashboard,
    setActiveTab,
    createDashboard,
    createTab,
    updateTab,
    addWidget,
    updateWidget,
    updateSyncGroupSymbol,
  } = useDashboard();
  const { setGlobalSymbol: setWidgetGroupGlobalSymbol } = useWidgetGroups();
  const { setGlobalSymbol: setLinkedGlobalSymbol } = useSymbolLink();

  useEffect(() => {
    if (!open) return;
    setRecentSearches(readCommandPaletteRecents());
    setSearch('');
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const trimmedSearch = search.trim();
  const tickerQuery = useQuery({
    queryKey: ['command-palette-tickers', trimmedSearch],
    queryFn: () => searchTickers(trimmedSearch, { limit: 12 }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const resolveTradingViewDestination = () => {
    let dashboard =
      state.dashboards.find(
        (item) => item.name === GLOBAL_MARKETS_DASHBOARD_NAME && item.isEditable !== false,
      ) ??
      (activeDashboard && activeDashboard.isEditable !== false ? activeDashboard : null) ??
      state.dashboards.find((item) => item.isEditable !== false) ??
      null;

    if (!dashboard) {
      dashboard = createDashboard({
        name: GLOBAL_MARKETS_DASHBOARD_NAME,
        description: 'Charts and macro context for crypto, indices, and global assets.',
        folderId: 'folder-initial',
      });
    }

    let tab =
      dashboard.tabs.find((item) => item.name === GLOBAL_MARKETS_TAB_NAME) ??
      null;

    if (!tab) {
      const firstTab = dashboard.tabs[0] ?? null;
      if (firstTab && dashboard.name === GLOBAL_MARKETS_DASHBOARD_NAME && firstTab.widgets.length === 0) {
        updateTab(dashboard.id, firstTab.id, { name: GLOBAL_MARKETS_TAB_NAME });
        tab = { ...firstTab, name: GLOBAL_MARKETS_TAB_NAME };
      } else {
        tab = createTab(dashboard.id, GLOBAL_MARKETS_TAB_NAME);
      }
    }

    const existingWidget = tab.widgets.find((item) => {
      if (item.type === 'tradingview_chart') return true;
      if (item.type !== 'price_chart') return false;
      const configuredSymbol = typeof item.config?.symbol === 'string' ? item.config.symbol : '';
      return configuredSymbol.includes(':');
    }) ?? null;

    setActiveDashboard(dashboard.id);
    setActiveTab(tab.id);

    return {
      dashboardId: dashboard.id,
      tabId: tab.id,
      existingWidgetId: existingWidget?.id ?? null,
      existingConfig: existingWidget?.config ?? {},
    };
  };

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
      description: 'Open a global asset chart widget in the Global Markets tab',
    };
    actions.set(tradingViewItem.id, () => {
      const destination = resolveTradingViewDestination();
      if (destination.existingWidgetId) {
        updateWidget(destination.dashboardId, destination.tabId, destination.existingWidgetId, {
          type: 'tradingview_chart',
          config: { ...destination.existingConfig, symbol: 'NASDAQ:AAPL' },
        });
      } else {
        addWidget(destination.dashboardId, destination.tabId, {
          type: 'tradingview_chart',
          tabId: destination.tabId,
          config: { symbol: 'NASDAQ:AAPL' },
          layout: { x: 0, y: Infinity, w: 10, h: 8, minW: 8, minH: 6 },
        });
      }
      onOpenChange(false);
    });
    items.push(tradingViewItem);

    return { items, actions };
  }, [
    activeDashboard,
    addWidget,
    createDashboard,
    createTab,
    onOpenChange,
    router,
    setActiveDashboard,
    setActiveTab,
    state.dashboards,
    updateTab,
    updateWidget,
  ]);

  const sections = useMemo(
    () => buildTickerPaletteSections(trimmedSearch, recentSearches, tickerQuery.data?.results || [], commandActions.items),
    [commandActions.items, recentSearches, tickerQuery.data?.results, trimmedSearch],
  );

  const flatItems = useMemo<RenderItem[]>(
    () => sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionKey: section.key }))),
    [sections],
  );

  useEffect(() => {
    if (!flatItems.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, flatItems.length - 1));
  }, [flatItems]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((current) => (flatItems.length ? (current + 1) % flatItems.length : 0));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((current) => (flatItems.length ? (current - 1 + flatItems.length) % flatItems.length : 0));
        return;
      }

      if (event.key === 'Enter') {
        const selected = flatItems[selectedIndex];
        if (!selected) return;
        event.preventDefault();
        handleSelect(selected);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [flatItems, open, selectedIndex]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector<HTMLElement>(`[data-command-item-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

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

  const applyVietnamSymbol = (symbol: string) => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) return;
    setWidgetGroupGlobalSymbol(normalizedSymbol);
    setLinkedGlobalSymbol(normalizedSymbol);
    if (activeDashboard) {
      updateSyncGroupSymbol(activeDashboard.id, 1, normalizedSymbol);
    }
  };

  const handleTickerSelect = (item: SearchTickerResult) => {
    saveRecent(item);
    captureAnalyticsEvent(ANALYTICS_EVENTS.commandPaletteResultSelected, {
      source: 'command_palette',
      result_type: item.type,
      symbol: item.symbol,
      exchange: item.exchange,
      query_length: trimmedSearch.length,
      section: 'search',
    });

    if (item.type === 'vn_stock') {
      applyVietnamSymbol(item.symbol);
      onOpenChange(false);
      return;
    }

    const destination = resolveTradingViewDestination();
    if (destination.existingWidgetId) {
      updateWidget(destination.dashboardId, destination.tabId, destination.existingWidgetId, {
        type: 'tradingview_chart',
        config: { ...destination.existingConfig, symbol: item.tv_symbol || item.symbol },
      });
    } else {
      addWidget(destination.dashboardId, destination.tabId, {
        type: 'tradingview_chart',
        tabId: destination.tabId,
        config: { symbol: item.tv_symbol || item.symbol },
        layout: { x: 0, y: Infinity, w: 10, h: 8, minW: 8, minH: 6 },
      });
    }
    onOpenChange(false);
  };

  const handleSelect = (item: RenderItem) => {
    const tickerResult = (tickerQuery.data?.results || []).find(
      (result) => result.symbol === item.symbol && result.type === item.type,
    );
    const isTicker = item.type !== 'command' && item.type !== 'workspace';

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

    captureAnalyticsEvent(ANALYTICS_EVENTS.commandPaletteResultSelected, {
      source: 'command_palette',
      result_type: item.type,
      result_id: item.id,
      section: item.sectionKey,
      query_length: trimmedSearch.length,
      symbol: item.symbol,
    });

    commandActions.actions.get(item.id)?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-[rgba(2,6,23,0.72)] p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette backdrop"
        className="absolute inset-0 cursor-default"
        onClick={() => onOpenChange(false)}
      />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-4 py-3">
          <CommandIcon className="h-5 w-5 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search tickers, crypto, indices, or commands..."
            aria-label="Command palette search"
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

        <div ref={listRef} className="max-h-[480px] overflow-y-auto px-2 py-2 scrollbar-hide">
          {flatItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--text-muted)]">
              <Search className="h-8 w-8 opacity-30" />
              <span>No results found for "{trimmedSearch}"</span>
            </div>
          ) : (
            sections.map((section) => (
              <PaletteSection
                key={section.key}
                query={trimmedSearch}
                section={section}
                selectedIndex={selectedIndex}
                flatItems={flatItems}
                onHover={setSelectedIndex}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <div className="flex items-center gap-4">
            <ShortcutPill label="Ctrl+K" hint="Open" />
            <ShortcutPill label="↑↓" hint="Navigate" />
            <ShortcutPill label="Enter" hint="Select" />
            <ShortcutPill label="Esc" hint="Close" />
          </div>
          <span className="font-mono">VNIBB Discover</span>
        </div>
      </div>
    </div>
  );
}

function PaletteSection({
  query,
  section,
  selectedIndex,
  flatItems,
  onHover,
  onSelect,
}: {
  query: string;
  section: CommandPaletteSection;
  selectedIndex: number;
  flatItems: RenderItem[];
  onHover: (index: number) => void;
  onSelect: (item: RenderItem) => void;
}) {
  return (
    <div className="mb-2">
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {section.label}
      </div>
      {section.items.map((item) => {
        const flatIndex = flatItems.findIndex((candidate) => candidate.id === item.id && candidate.type === item.type);
        const active = flatIndex === selectedIndex;
        const isTicker = item.type !== 'command' && item.type !== 'workspace';
        const icon = isTicker
          ? getTickerIcon(item.type as SearchTickerResult['type'])
          : getCommandIcon(item);

        return (
          <button
            key={`${item.id}:${item.type}`}
            type="button"
            data-command-item-index={flatIndex}
            onMouseEnter={() => flatIndex >= 0 && onHover(flatIndex)}
            onClick={() => onSelect(item as RenderItem)}
            className={cn(
              'group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
              active
                ? 'bg-blue-600/10 text-blue-300'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/50 hover:text-[var(--text-primary)]',
            )}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {highlightMatch(item.label, query)}
              </div>
              {item.description ? (
                <div className="truncate text-xs text-[var(--text-muted)]">
                  {highlightMatch(item.description, query)}
                </div>
              ) : null}
            </div>
            {item.exchange ? (
              <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                {item.exchange}
              </span>
            ) : null}
            {item.type === 'crypto' || item.type === 'index' || item.type === 'us_stock' ? (
              <ExternalLink className="h-3.5 w-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ShortcutPill({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center gap-1">
      <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5">{label}</kbd>
      <span>{hint}</span>
    </div>
  );
}

export default CommandPalette;
