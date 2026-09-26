import type { WidgetGroupId } from '@/types/widget';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';

/**
 * How a widget's ticker relates to its group.
 *
 * - `group`: the widget follows its group's ticker. Group changes move the widget.
 * - `override`: the widget shows its own ticker while staying a member of the group.
 *   Group changes leave it alone; "Reset to group" returns it to `group`.
 */
export type TickerScopeMode = 'group' | 'override';

export interface TickerScope {
  mode: TickerScopeMode;
  /** The ticker a widget shows in `override` mode; unused in `group` mode. */
  symbol: string | null;
}

export const GROUP_TICKER_SCOPE: TickerScope = { mode: 'group', symbol: null };

/** Reads the persisted scope from a widget config, tolerating legacy shapes. */
export function readTickerScope(config: Record<string, unknown> | undefined): TickerScope {
  const mode = config?.tickerScope;
  if (mode === 'override') {
    const symbol = normalizeTickerSymbol(config?.symbol as string | undefined);
    return symbol ? { mode: 'override', symbol } : GROUP_TICKER_SCOPE;
  }
  return GROUP_TICKER_SCOPE;
}

/**
 * The ticker a widget displays, given its scope and its group's current ticker.
 * An override with no usable symbol degrades to the group ticker rather than blank.
 */
export function resolveWidgetSymbol(scope: TickerScope, groupSymbol: string | null | undefined): string {
  if (scope.mode === 'override' && scope.symbol) return scope.symbol;
  return groupSymbol ?? '';
}


/**
 * Whether switching the group a widget belongs to should rewrite its ticker.
 * Only `group`-mode widgets adopt; an override keeps its own ticker.
 */
export function shouldAdoptOnGroupChange(
  scope: TickerScope,
  nextGroupSymbol: string | null | undefined,
  currentSymbol: string,
): boolean {
  if (scope.mode !== 'group') return false;
  const next = normalizeTickerSymbol(nextGroupSymbol ?? undefined);
  return Boolean(next) && next !== normalizeTickerSymbol(currentSymbol);
}

export function describeTickerScope(mode: TickerScopeMode, groupName: string): string {
  return mode === 'override'
    ? `Ticker local to this widget · not shared with ${groupName}`
    : `Ticker shared with ${groupName} · period stays separate`;
}

export function tickerScopeBadge(mode: TickerScopeMode): string {
  return mode === 'override' ? 'Ticker local' : 'Ticker shared';
}

export interface GroupScopeOption {
  id: WidgetGroupId;
  name: string;
  symbol: string;
}

/** Label for one entry in the group picker, marking where the group's ticker comes from. */
export function describeGroupOption(
  group: GroupScopeOption,
  selected: boolean,
  activeSymbol: string,
): string {
  if (selected) return `${group.name} · ${activeSymbol}`;
  return `${group.name} · ${group.symbol}`;
}
