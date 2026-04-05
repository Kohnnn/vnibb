'use client';

import { useMemo, useState } from 'react';
import { Building2, Search } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useIndustries, useSymbolsByExchange } from '@/lib/queries';

interface ListingBrowserWidgetProps {
  id: string;
  hideHeader?: boolean;
  onRemove?: () => void;
  onSymbolClick?: (symbol: string) => void;
}

type ExchangeFilter = 'ALL' | 'HOSE' | 'HNX' | 'UPCOM'

export function ListingBrowserWidget({
  id,
  hideHeader,
  onRemove,
  onSymbolClick,
}: ListingBrowserWidgetProps) {
  const [exchange, setExchange] = useState<ExchangeFilter>('ALL')
  const [search, setSearch] = useState('')

  const industriesQuery = useIndustries(true)
  const hoseQuery = useSymbolsByExchange('HOSE', exchange === 'HOSE')
  const hnxQuery = useSymbolsByExchange('HNX', exchange === 'HNX')
  const upcomQuery = useSymbolsByExchange('UPCOM', exchange === 'UPCOM')

  const exchangeSymbols = useMemo(() => {
    if (exchange === 'HOSE') return new Set((hoseQuery.data?.data || []).map((item) => item.symbol))
    if (exchange === 'HNX') return new Set((hnxQuery.data?.data || []).map((item) => item.symbol))
    if (exchange === 'UPCOM') return new Set((upcomQuery.data?.data || []).map((item) => item.symbol))
    return null
  }, [exchange, hnxQuery.data?.data, hoseQuery.data?.data, upcomQuery.data?.data])

  const rows = useMemo(() => {
    const base = industriesQuery.data?.data || []
    const normalizedSearch = search.trim().toLowerCase()
    return base.filter((item) => {
      if (exchangeSymbols && !exchangeSymbols.has(item.symbol)) {
        return false
      }
      if (!normalizedSearch) return true
      return item.symbol.toLowerCase().includes(normalizedSearch)
        || item.organ_name.toLowerCase().includes(normalizedSearch)
        || item.icb_name3.toLowerCase().includes(normalizedSearch)
        || item.icb_name4.toLowerCase().includes(normalizedSearch)
    })
  }, [exchangeSymbols, industriesQuery.data?.data, search])

  const hasData = rows.length > 0
  const isLoading = industriesQuery.isLoading || hoseQuery.isLoading || hnxQuery.isLoading || upcomQuery.isLoading
  const error = industriesQuery.error || hoseQuery.error || hnxQuery.error || upcomQuery.error
  const updatedAt = Math.max(
    industriesQuery.dataUpdatedAt,
    hoseQuery.dataUpdatedAt,
    hnxQuery.dataUpdatedAt,
    upcomQuery.dataUpdatedAt,
  )

  return (
    <WidgetContainer
      title="Listing Browser"
      widgetId={id}
      onRefresh={() => {
        void industriesQuery.refetch()
        if (exchange === 'HOSE') void hoseQuery.refetch()
        if (exchange === 'HNX') void hnxQuery.refetch()
        if (exchange === 'UPCOM') void upcomQuery.refetch()
      }}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      hideHeader={hideHeader}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search symbol, company, or industry..."
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
              {(['ALL', 'HOSE', 'HNX', 'UPCOM'] as ExchangeFilter[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setExchange(item)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${exchange === item ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <WidgetMeta updatedAt={updatedAt} isFetching={isLoading && hasData} note={`${exchange} universe`} align="right" />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => void industriesQuery.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No listings matched your filters." icon={<Building2 size={18} />} />
          ) : (
            <div className="space-y-1.5">
              {rows.map((item) => (
                <button
                  key={`${item.symbol}-${item.icb_name4}`}
                  type="button"
                  onClick={() => onSymbolClick?.(item.symbol)}
                  className="block w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3 text-left transition-colors hover:border-blue-500/30 hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{item.symbol}</div>
                      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{item.organ_name}</div>
                    </div>
                    <div className="text-right text-[10px] text-[var(--text-muted)]">
                      <div>{item.icb_name3 || item.icb_name2 || 'Industry'}</div>
                      <div>{item.icb_name4 || 'Group'}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  )
}

export default ListingBrowserWidget
