'use client';

import { ArrowRightLeft, FolderOpen } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  describeGroupOption,
  describeTickerScope,
  tickerScopeBadge,
  type TickerScopeMode,
} from '@/lib/widgetScope';
import type { WidgetGroupConfig, WidgetGroupId } from '@/types/widget';

interface WidgetGroupSelectorProps {
  widgetGroup: WidgetGroupId;
  groups: Record<WidgetGroupId, WidgetGroupConfig>;
  getColorForGroup: (groupId: WidgetGroupId) => string;
  getSymbolForGroup: (groupId: WidgetGroupId) => string;
  currentSymbol: string;
  onGroupChange: (groupId: WidgetGroupId) => void;
  /** `override` means the widget keeps its own ticker instead of the group's. */
  scopeMode: TickerScopeMode;
  /** Detach: keep the ticker the widget shows right now as its own. */
  onDetachTicker?: () => void;
  /** Re-attach: drop the widget's own ticker and follow its group again. */
  onFollowGroupTicker?: () => void;
}

const CONTROL_CLASS =
  'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';

export function WidgetGroupSelector({
  widgetGroup,
  groups,
  getColorForGroup,
  getSymbolForGroup,
  currentSymbol,
  onGroupChange,
  scopeMode,
  onDetachTicker,
  onFollowGroupTicker,
}: WidgetGroupSelectorProps) {
  const groupName = groups[widgetGroup]?.name ?? 'Global';
  const groupSymbol = getSymbolForGroup(widgetGroup);
  const badge = tickerScopeBadge(scopeMode);
  const scopeDescription = describeTickerScope(scopeMode, groupName);
  const isDetached = scopeMode === 'override';
  const tickerLabel = isDetached ? `${currentSymbol} · widget only` : `${currentSymbol} · follows ${groupName}`;

  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)]/60 px-1.5 py-0.5"
      style={{ borderLeftColor: getColorForGroup(widgetGroup), borderLeftWidth: 2 }}
      title={`${groupName} · ${currentSymbol}. ${scopeDescription}`}
    >
      <span
        data-testid="ticker-scope-badge"
        className={
          isDetached
            ? `${CONTROL_CLASS} bg-amber-500/15 text-amber-300`
            : `${CONTROL_CLASS} bg-[var(--bg-tertiary)] text-[var(--text-muted)]`
        }
      >
        {badge}
      </span>

      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]" title={tickerLabel}>
          {tickerLabel}
        </span>
        <span className="truncate text-[9px] leading-3 text-[var(--text-muted)]" title={scopeDescription}>
          {scopeDescription}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Ticker group: ${groupName}, current ticker ${currentSymbol}. ${scopeDescription}`}
          className={`${CONTROL_CLASS} text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`}
        >
          <FolderOpen size={12} />
          {groupName}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[13rem]">
          <DropdownMenuLabel className="text-[11px]">Ticker group</DropdownMenuLabel>
          {Object.entries(groups).map(([id, group]) => {
            const groupId = id as WidgetGroupId;
            const selected = groupId === widgetGroup;
            return (
              <DropdownMenuItem
                key={groupId}
                onClick={() => onGroupChange(groupId)}
                className={selected ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : undefined}
                aria-label={describeGroupOption(
                  { id: groupId, name: group.name, symbol: getSymbolForGroup(groupId) },
                  selected,
                  currentSymbol,
                )}
              >
                <span
                  className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: getColorForGroup(groupId) }}
                />
                <span className="min-w-0 flex-1 truncate">{describeGroupOption(
                  { id: groupId, name: group.name, symbol: getSymbolForGroup(groupId) },
                  selected,
                  currentSymbol,
                )}</span>
                {selected && <span className="ml-2 text-[10px] text-[var(--text-muted)]">current</span>}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger aria-label={`Ticker scope for this widget. ${scopeDescription}`}>
              <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate">Ticker scope</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[13rem]">
              {isDetached
                ? onFollowGroupTicker && (
                    <DropdownMenuItem onClick={onFollowGroupTicker} aria-label={`Follow ${groupName}`}>
                      Follow {groupName}
                    </DropdownMenuItem>
                  )
                : onDetachTicker && (
                    <DropdownMenuItem onClick={onDetachTicker} aria-label="Keep ticker in this widget">
                      Keep ticker in this widget
                    </DropdownMenuItem>
                  )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {isDetached && groupSymbol && groupSymbol !== currentSymbol && (
        <span className="truncate text-[9px] leading-3 text-[var(--text-muted)]">
          {groupName} · {groupSymbol}
        </span>
      )}
    </div>
  );
}
