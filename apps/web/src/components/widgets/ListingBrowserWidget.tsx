'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Filter, FolderOpen, RotateCcw, Save, Search, X } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useSymbols, useSymbolsByGroup } from '@/lib/queries';
import {
  readListingBrowserViews,
  buildListingBrowserFilterSummary,
  buildListingBrowserViewName,
  removeListingBrowserView,
  saveListingBrowserView,
  type ListingBrowserView,
} from '@/lib/listingBrowserViews';

interface ListingBrowserWidgetProps {
  id: string;
  hideHeader?: boolean;
  onRemove?: () => void;
  onSymbolClick?: (symbol: string) => void;
}

type ExchangeFilter = 'ALL' | 'HOSE' | 'HNX' | 'UPCOM'
type GroupFilter = 'ALL' | 'VN30' | 'VN100' | 'HNX30'
type SortMode = 'symbol' | 'company' | 'industry'

const GROUP_OPTIONS: GroupFilter[] = ['ALL', 'VN30', 'VN100', 'HNX30']

export function ListingBrowserWidget({
  id,
  hideHeader,
  onRemove,
  onSymbolClick,
}: ListingBrowserWidgetProps) {
  const [exchange, setExchange] = useState<ExchangeFilter>('ALL')
  const [group, setGroup] = useState<GroupFilter>('ALL')
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('ALL')
  const [sortMode, setSortMode] = useState<SortMode>('symbol')
  const [savedViews, setSavedViews] = useState<ListingBrowserView[]>([])

  const symbolsQuery = useSymbols()
  const groupQuery = useSymbolsByGroup(group, group !== 'ALL')

  useEffect(() => {
    setSavedViews(readListingBrowserViews())
  }, [])

  const groupSymbols = useMemo(
    () => new Set((groupQuery.data?.data || []).map((item) => item.symbol)),
    [groupQuery.data?.data]
  )

  const rows = useMemo(() => {
    const base = symbolsQuery.data?.data || []
    const normalizedSearch = search.trim().toLowerCase()

    const filtered = base.filter((item) => {
      if (exchange !== 'ALL' && item.exchange !== exchange) return false
      if (group !== 'ALL' && !groupSymbols.has(item.symbol)) return false
      if (industry !== 'ALL' && (item.industry || 'Unknown') !== industry) return false
      if (!normalizedSearch) return true

      return item.symbol.toLowerCase().includes(normalizedSearch)
        || String(item.organ_name || '').toLowerCase().includes(normalizedSearch)
        || String(item.industry || '').toLowerCase().includes(normalizedSearch)
    })

    return filtered.sort((left, right) => {
      if (sortMode === 'company') {
        return String(left.organ_name || '').localeCompare(String(right.organ_name || ''))
      }
      if (sortMode === 'industry') {
        return String(left.industry || '').localeCompare(String(right.industry || ''))
      }
      return left.symbol.localeCompare(right.symbol)
    })
  }, [exchange, group, groupSymbols, industry, search, sortMode, symbolsQuery.data?.data])

  const industries = useMemo(() => {
    const unique = new Set((symbolsQuery.data?.data || []).map((item) => item.industry || 'Unknown'))
    return ['ALL', ...Array.from(unique).sort()]
  }, [symbolsQuery.data?.data])

  const exchangeCounts = useMemo(() => {
    const base = symbolsQuery.data?.data || []
    return {
      HOSE: base.filter((item) => item.exchange === 'HOSE').length,
      HNX: base.filter((item) => item.exchange === 'HNX').length,
      UPCOM: base.filter((item) => item.exchange === 'UPCOM').length,
    }
  }, [symbolsQuery.data?.data])

  const hasData = rows.length > 0
  const isLoading = symbolsQuery.isLoading || groupQuery.isLoading
  const error = symbolsQuery.error || (group !== 'ALL' ? groupQuery.error : null)
  const updatedAt = Math.max(symbolsQuery.dataUpdatedAt, groupQuery.dataUpdatedAt)
  const hasActiveFilters = exchange !== 'ALL' || group !== 'ALL' || industry !== 'ALL' || search.trim() !== '' || sortMode !== 'symbol'
  const viewInput = { exchange, group, industry, search, sortMode }
  const filterSummary = buildListingBrowserFilterSummary(viewInput)

  const clearFilters = () => {
    setExchange('ALL')
    setGroup('ALL')
    setIndustry('ALL')
    setSearch('')
    setSortMode('symbol')
  }

  const saveCurrentView = () => {
    const next = saveListingBrowserView({
      id: `${exchange}:${group}:${industry}:${search}:${sortMode}`,
      name: buildListingBrowserViewName(viewInput),
      exchange,
      group,
      industry,
      search,
      sortMode,
      updatedAt: new Date().toISOString(),
    })
    setSavedViews(next)
  }

  const applySavedView = (view: ListingBrowserView) => {
    setExchange(view.exchange as ExchangeFilter)
    setGroup(view.group as GroupFilter)
    setIndustry(view.industry)
    setSearch(view.search)
    if (view.sortMode) setSortMode(view.sortMode as SortMode)
  }

  return (
    <WidgetContainer
      title="Listing Browser"
      subtitle="Discovery filters, exchange universes, and saved views"
      widgetId={id}
      onRefresh={() => {
        void symbolsQuery.refetch()
        if (group !== 'ALL') void groupQuery.refetch()
      }}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      hideHeader={hideHeader}
      noPadding
      exportData={rows}
      exportFilename="listing_browser"
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2 space-y-2">
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
            <WidgetMeta updatedAt={updatedAt} isFetching={isLoading && hasData} note={`${rows.length} matches`} align="right" />
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
              {(['ALL', 'HOSE', 'HNX', 'UPCOM'] as ExchangeFilter[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setExchange(item)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${exchange === item ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  {item === 'ALL' ? `All (${(symbolsQuery.data?.count || 0)})` : `${item} (${exchangeCounts[item] || 0})`}
                </button>
              ))}
            </div>

            <select value={group} onChange={(event) => setGroup(event.target.value as GroupFilter)} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-blue-500">
              {GROUP_OPTIONS.map((option) => (
                <option key={option} value={option}>{option === 'ALL' ? 'All groups' : option}</option>
              ))}
            </select>

            <select value={industry} onChange={(event) => setIndustry(event.target.value)} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-blue-500">
              {industries.map((option) => (
                <option key={option} value={option}>{option === 'ALL' ? 'All industries' : option}</option>
              ))}
            </select>

            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-blue-500">
              <option value="symbol">Sort: Symbol</option>
              <option value="company">Sort: Company</option>
              <option value="industry">Sort: Industry</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] text-[var(--text-secondary)]">
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={12} className="text-cyan-300" />
              <span>{filterSummary}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={11} /> Clear
              </button>
              <button
                type="button"
                onClick={saveCurrentView}
                className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 font-semibold text-blue-200 transition-colors hover:bg-blue-500/20"
              >
                <Save size={11} /> Save View
              </button>
            </div>
          </div>

          {savedViews.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {savedViews.map((view) => (
                <div key={view.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                  <button type="button" onClick={() => applySavedView(view)} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                    <FolderOpen size={11} /> {view.name}
                  </button>
                  <button type="button" onClick={() => setSavedViews(removeListingBrowserView(view.id))} className="text-[var(--text-muted)] hover:text-rose-300">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => void symbolsQuery.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message={hasActiveFilters ? 'No listings matched your discovery filters. Clear filters or broaden the saved view.' : 'No listing universe loaded yet.'}
              icon={<Building2 size={18} />}
            />
          ) : (
            <div className="space-y-1.5">
              {rows.map((item) => (
                <button
                  key={item.symbol}
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
                      <div>{item.exchange || 'Exchange'}</div>
                      <div>{item.industry || 'Industry unavailable'}</div>
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
