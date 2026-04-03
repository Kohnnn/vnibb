// Header component with symbol search

'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Command,
  Search,
  User,
  X,
  MoreHorizontal,
  Settings2,
  LayoutGrid,
  Lock,
  Sparkles,
  Unlock,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { AlertNotificationPanel } from '../widgets/AlertNotificationPanel'
import { useTheme } from '@/contexts/ThemeContext'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { useHistoricalPrices, useMarketOverview, useStockQuote } from '@/lib/queries'
import { probeBackendReadiness } from '@/lib/backendHealth'
import type { UnitDisplay } from '@/lib/units'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const UNIT_OPTIONS: Array<{ value: UnitDisplay; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'K', label: 'K' },
  { value: 'M', label: 'M' },
  { value: 'B', label: 'B' },
  { value: 'raw', label: 'Raw' },
]

const MARKET_TIMEZONE = 'Asia/Ho_Chi_Minh'
const HEADER_MARKET_INDICES = [
  { key: 'VNINDEX', label: 'VN-INDEX' },
  { key: 'VN30', label: 'VN30' },
] as const

type ConnectionState = 'checking' | 'online' | 'offline' | 'degraded'

function formatHeaderPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatHeaderPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function formatHeaderDelta(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function normalizeIndexName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function getVietnamMarketStatus(reference = new Date()): { label: string; isOpen: boolean } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: MARKET_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(reference)
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')

  const isBusinessDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)
  const totalMinutes = hour * 60 + minute
  const morningSession = totalMinutes >= 9 * 60 && totalMinutes <= 11 * 60 + 30
  const afternoonSession = totalMinutes >= 13 * 60 && totalMinutes <= 15 * 60
  const isOpen = isBusinessDay && (morningSession || afternoonSession)

  return {
    isOpen,
    label: isOpen ? 'Market Open (HOSE)' : 'Market Closed (HOSE)',
  }
}

interface HeaderProps {
  currentSymbol: string
  onSymbolChange: (symbol: string) => void
  isEditing?: boolean
  onEditToggle?: () => void
  onAIClick?: () => void
  isAIOpen?: boolean
  onResetLayout?: () => void
  onAutoFitLayout?: () => void
  onCollapseAll?: () => void
  onExpandAll?: () => void
  unitDisplay?: UnitDisplay
  onUnitDisplayChange?: (value: UnitDisplay) => void
}

export function Header({
  currentSymbol,
  onSymbolChange,
  isEditing = false,
  onEditToggle,
  onAIClick,
  isAIOpen = false,
  onResetLayout,
  onAutoFitLayout,
  onCollapseAll,
  onExpandAll,
  unitDisplay = 'auto',
  onUnitDisplayChange,
}: HeaderProps) {
  const [searchValue, setSearchValue] = useState(currentSymbol)
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasActionMenu = Boolean(
    onResetLayout || onCollapseAll || onExpandAll
  )
  const { resolvedTheme } = useTheme()
  const [marketClock, setMarketClock] = useState(() => Date.now())
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('checking')

  const quoteQuery = useStockQuote(currentSymbol, Boolean(currentSymbol))
  const marketOverviewQuery = useMarketOverview(true)
  const { prices: liveHeaderIndexPrices } = useWebSocket({
    symbols: HEADER_MARKET_INDICES.map((index) => index.key),
  })
  const historyQuery = useHistoricalPrices(currentSymbol, {
    interval: '1D',
    enabled: Boolean(currentSymbol),
  })

  const quote = quoteQuery.data
  const displayQuoteChangePct = useMemo(() => {
    if (quote?.changePct != null) return quote.changePct

    const points = historyQuery.data?.data || []
    const recentPoints = points.filter(
      (point) => Number.isFinite(point?.close)
    )
    if (recentPoints.length < 2) return null

    const latest = recentPoints[recentPoints.length - 1]?.close
    const previous = recentPoints[recentPoints.length - 2]?.close
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) {
      return null
    }

    return ((latest - previous) / previous) * 100
  }, [historyQuery.data?.data, quote?.changePct])

  const quoteIsPositive = (displayQuoteChangePct ?? 0) >= 0
  const quoteChangeClass =
    displayQuoteChangePct == null
      ? 'text-[var(--text-muted)]'
      : quoteIsPositive
        ? resolvedTheme === 'light'
          ? 'text-emerald-700'
          : 'text-emerald-400'
        : resolvedTheme === 'light'
          ? 'text-rose-700'
          : 'text-rose-400'
  const marketStatus = useMemo(() => getVietnamMarketStatus(new Date(marketClock)), [marketClock])
  const headerMarketIndices = useMemo(() => {
    const marketIndexLookup = new Map(
      (marketOverviewQuery.data?.data ?? []).map((item) => [
        normalizeIndexName(item.index_name),
        item,
      ])
    )

    return HEADER_MARKET_INDICES.map((index) => {
      const item = marketIndexLookup.get(index.key)
      const liveItem = liveHeaderIndexPrices.get(index.key)
      const liveValue =
        liveItem && Number.isFinite(liveItem.price) && liveItem.price > 0
          ? liveItem.price
          : null
      const baseValue = item?.current_value ?? null
      const baseChange = item?.change ?? null
      const liveChangeValue = liveItem?.change ?? null
      const liveChangePctValue = liveItem?.change_pct ?? null
      const previousClose =
        baseValue !== null && baseChange !== null ? baseValue - baseChange : null
      const hasLiveDelta =
        liveItem != null
        && ((liveChangeValue !== null && Math.abs(liveChangeValue) > 1e-9)
          || (liveChangePctValue !== null && Math.abs(liveChangePctValue) > 1e-9))
      const derivedLiveChange =
        liveValue !== null && previousClose !== null ? liveValue - previousClose : null
      const change = hasLiveDelta
        ? liveChangeValue
        : derivedLiveChange ?? item?.change ?? null
      const changePct = hasLiveDelta
        ? liveChangePctValue
        : change !== null && previousClose !== null && previousClose !== 0
          ? (change / previousClose) * 100
          : item?.change_pct ?? null

      return {
        ...index,
        value: liveValue ?? baseValue,
        change,
        changePct,
      }
    }).filter((index) => index.value !== null)
  }, [liveHeaderIndexPrices, marketOverviewQuery.data?.data])

  const healthBadge = useMemo(() => {
    if (connectionStatus === 'online') {
      return {
        label: 'Healthy',
        className: cn(
          'border-emerald-500/25 bg-emerald-500/10',
          resolvedTheme === 'light' ? 'text-emerald-700' : 'text-emerald-300'
        ),
        dotClassName: resolvedTheme === 'light' ? 'bg-emerald-600' : 'bg-emerald-400',
      }
    }
    if (connectionStatus === 'degraded' || connectionStatus === 'checking') {
      return {
        label: connectionStatus === 'checking' ? 'Checking' : 'Degraded',
        className: cn(
          'border-amber-500/30 bg-amber-500/10',
          resolvedTheme === 'light' ? 'text-amber-800' : 'text-amber-200'
        ),
        dotClassName: resolvedTheme === 'light' ? 'bg-amber-600' : 'bg-amber-400',
      }
    }
    return {
      label: 'Offline',
      className: cn(
        'border-rose-500/30 bg-rose-500/10',
        resolvedTheme === 'light' ? 'text-rose-700' : 'text-rose-300'
      ),
      dotClassName: resolvedTheme === 'light' ? 'bg-rose-600' : 'bg-rose-400',
    }
  }, [connectionStatus, resolvedTheme])

  const healthTitle = `${marketStatus.label} • Backend ${healthBadge.label}`

  useEffect(() => {
    if (!isSearching) {
      setSearchValue(currentSymbol)
    }
  }, [currentSymbol, isSearching])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarketClock(Date.now())
    }, 60 * 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let mounted = true

    const checkConnection = async () => {
      try {
        const { healthOk, dataOk } = await probeBackendReadiness(8000)
        if (!mounted) return

        if (healthOk && dataOk) {
          setConnectionStatus('online')
        } else if (healthOk) {
          setConnectionStatus('degraded')
        } else {
          setConnectionStatus('offline')
        }
      } catch {
        if (mounted) {
          setConnectionStatus('offline')
        }
      }
    }

    checkConnection()
    const interval = window.setInterval(checkConnection, 60 * 1000)

    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [])

  const handleSearch = useCallback(() => {
    const normalized = searchValue.trim().toUpperCase()
    if (normalized) {
      onSymbolChange(normalized)
      setSearchValue(normalized)
      setIsSearching(false)
    }
  }, [searchValue, onSymbolChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearch()
      } else if (e.key === 'Escape') {
        setSearchValue(currentSymbol)
        setIsSearching(false)
      }
    },
    [handleSearch, currentSymbol]
  )

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--dashboard-shell-bg)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--dashboard-shell-bg)]/85">
      <div className="px-4 py-2">
        <div data-tour="header-bar" className="grid min-h-[2.75rem] grid-cols-[minmax(0,1fr)_minmax(160px,240px)_auto] items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,380px)_auto] md:gap-3">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <div className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-secondary)]">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            <span>VNIBB</span>
          </div>

          <div className="inline-flex min-w-0 shrink-0 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
              Symbol
            </span>
            <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
              {currentSymbol}
            </span>
          </div>

            <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  {currentSymbol}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {formatHeaderPrice(quote?.price)}
                  </span>
                  <span className={cn('text-xs font-semibold', quoteChangeClass)}>
                    {formatHeaderPercent(displayQuoteChangePct)}
                  </span>
                </div>
              </div>
            </div>

            <div className="hidden min-w-0 items-center gap-2 xl:flex">
              {headerMarketIndices.map((index) => {
                const positive = (index.changePct ?? 0) >= 0
                const toneClass = positive
                  ? resolvedTheme === 'light'
                    ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : resolvedTheme === 'light'
                    ? 'border-rose-500/20 bg-rose-500/8 text-rose-700'
                    : 'border-rose-500/20 bg-rose-500/10 text-rose-300'

                return (
                  <div
                    key={index.key}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5"
                  >
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
                        {index.label}
                      </div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        {formatHeaderPrice(index.value)}
                      </div>
                    </div>
                    <div className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', toneClass)}>
                      {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      <span>{formatHeaderPercent(index.changePct)}</span>
                    </div>
                  </div>
                )
              })}

              <div
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold',
                  healthBadge.className
                )}
                title={healthTitle}
                aria-label={healthTitle}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    healthBadge.dotClassName,
                    marketStatus.isOpen && connectionStatus === 'online' ? 'animate-pulse' : ''
                  )}
                />
                <span>{marketStatus.isOpen ? 'HOSE Open' : 'HOSE Closed'}</span>
              </div>
            </div>
          </div>
          </div>

          <div data-tour="header-search" className="relative w-full max-w-md justify-self-center">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            size={14}
          />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search symbol"
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value.toUpperCase())
              setIsSearching(true)
            }}
            onFocus={(e) => {
              setIsSearching(true)
              const normalizedCurrent = currentSymbol.trim().toUpperCase()
              const normalizedSearch = searchValue.trim().toUpperCase()
              if (normalizedSearch === normalizedCurrent) {
                setSearchValue('')
              } else {
                e.target.select()
              }
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setTimeout(() => {
                if (isSearching) handleSearch()
              }, 150)
            }}
            placeholder="Search symbol or press Ctrl+K"
            className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1.5 pl-8 pr-10 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all focus:border-blue-500/40 focus:outline-none focus:ring-1 focus:ring-blue-500/10"
          />
          {searchValue && searchValue !== currentSymbol && (
            <button
              type="button"
              onClick={() => {
                setSearchValue(currentSymbol)
                setIsSearching(false)
                inputRef.current?.focus()
              }}
              className="absolute right-10 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
          </div>

          <div data-tour="header-tools" className="flex items-center gap-2 justify-self-end">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('vnibb:open-command-palette'))}
            className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="Open command palette (Ctrl+K)"
            aria-label="Open command palette"
          >
            <Command size={13} />
            <span className="hidden md:inline">Ctrl+K</span>
          </button>

          {onAIClick && (
            <button
              type="button"
              onClick={onAIClick}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                isAIOpen
                  ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                  : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
              title="Open AI copilot"
              aria-label={isAIOpen ? 'Close AI copilot' : 'Open AI copilot'}
            >
              <Sparkles size={13} />
              <span className="hidden md:inline">AI Copilot</span>
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                title="Display settings"
              >
                <Settings2 size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem className="text-xs text-[var(--text-muted)] focus:bg-transparent focus:text-[var(--text-muted)]">
                Theme: Dark only
              </DropdownMenuItem>
              {onUnitDisplayChange && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] focus:bg-transparent focus:text-[var(--text-muted)]">
                    Unit display ({unitDisplay})
                  </DropdownMenuItem>
                  {UNIT_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => onUnitDisplayChange(option.value)}
                      className={cn(
                        'text-xs',
                        unitDisplay === option.value
                          ? 'text-blue-300'
                          : 'text-[var(--text-secondary)]'
                      )}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {(onAutoFitLayout || onEditToggle) && (
            <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/95 p-1 shadow-[0_10px_24px_rgba(2,6,23,0.18)]">
              {onAutoFitLayout && (
                <button
                  type="button"
                  onClick={onAutoFitLayout}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-gradient-to-r from-sky-500/18 to-cyan-500/12 px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition-colors hover:from-sky-500/28 hover:to-cyan-500/18"
                  title="Automatically arrange widgets to fill gaps"
                  aria-label="Auto-fit layout"
                >
                  <LayoutGrid size={13} />
                  <span className="hidden sm:inline">Auto-Fit</span>
                </button>
              )}

              {onEditToggle && (
                <button
                  type="button"
                  onClick={onEditToggle}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                    isEditing
                      ? 'border-amber-300/60 bg-gradient-to-r from-amber-500/22 to-orange-500/16 text-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.22)]'
                      : 'border-slate-400/20 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  )}
                  title="Lock or unlock dashboard layout for editing"
                  aria-label={isEditing ? 'Editing enabled' : 'Layout locked'}
                >
                  {isEditing ? <Unlock size={13} className="animate-pulse" /> : <Lock size={13} />}
                  <span className="hidden sm:inline">{isEditing ? 'Editing' : 'Layout Locked'}</span>
                </button>
              )}
            </div>
          )}

          {hasActionMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                  title="Dashboard actions"
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                {onResetLayout && (
                  <DropdownMenuItem onClick={onResetLayout} className="text-xs">
                    Reset layout
                  </DropdownMenuItem>
                )}
                {(onCollapseAll || onExpandAll) && <DropdownMenuSeparator />}
                {onCollapseAll && (
                  <DropdownMenuItem onClick={onCollapseAll} className="text-xs">
                    Collapse all widgets
                  </DropdownMenuItem>
                )}
                {onExpandAll && (
                  <DropdownMenuItem onClick={onExpandAll} className="text-xs">
                    Expand all widgets
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="hidden sm:block">
            <AlertNotificationPanel />
          </div>

          <button className="hidden rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] sm:block">
            <User size={16} />
          </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 xl:hidden scrollbar-hide">
          {headerMarketIndices.map((index) => {
            const positive = (index.changePct ?? 0) >= 0
            const accentClass = positive
              ? resolvedTheme === 'light'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
              : resolvedTheme === 'light'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-700'
                : 'border-rose-500/25 bg-rose-500/10 text-rose-300'

            return (
              <div
                key={`${index.key}-compact`}
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5"
              >
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {index.label}
                  </div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    {formatHeaderPrice(index.value)}
                  </div>
                </div>
                <div className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', accentClass)}>
                  {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  <span>{formatHeaderPercent(index.changePct)}</span>
                </div>
              </div>
            )
          })}

          <div
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold',
              healthBadge.className,
            )}
            title={healthTitle}
            aria-label={healthTitle}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                healthBadge.dotClassName,
                marketStatus.isOpen && connectionStatus === 'online' ? 'animate-pulse' : '',
              )}
            />
            <span>{marketStatus.isOpen ? 'HOSE Open' : 'HOSE Closed'}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
