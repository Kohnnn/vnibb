// Header component with symbol search

'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Search,
  User,
  X,
  MoreHorizontal,
  ChevronRight,
  Settings2,
} from 'lucide-react'
import { AlertNotificationPanel } from '../widgets/AlertNotificationPanel'
import { useTheme } from '@/contexts/ThemeContext'
import { useHistoricalPrices, useStockQuote } from '@/lib/queries'
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

type ConnectionState = 'checking' | 'online' | 'offline' | 'degraded'

function formatHeaderPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatHeaderPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  const normalized = Math.abs(value) > 1 ? value : value * 100
  const sign = normalized > 0 ? '+' : ''
  return `${sign}${normalized.toFixed(2)}%`
}

function getSparklinePoints(values: number[]): string {
  if (values.length < 2) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 100 - ((value - min) / range) * 100
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
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
    onAutoFitLayout || onResetLayout || onCollapseAll || onExpandAll || onEditToggle
  )
  const { resolvedTheme, setTheme } = useTheme()
  const [marketClock, setMarketClock] = useState(() => Date.now())
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('checking')

  const quoteQuery = useStockQuote(currentSymbol, Boolean(currentSymbol))
  const historyQuery = useHistoricalPrices(currentSymbol, {
    interval: '1D',
    enabled: Boolean(currentSymbol),
  })

  const quote = quoteQuery.data
  const sparklineValues = useMemo(() => {
    const points = historyQuery.data?.data || []
    return points
      .slice(-20)
      .map((point) => point.close)
      .filter((value): value is number => Number.isFinite(value))
  }, [historyQuery.data])

  const sparklinePoints = useMemo(() => getSparklinePoints(sparklineValues), [sparklineValues])
  const quoteIsPositive = (quote?.changePct ?? 0) >= 0
  const quoteChangeClass =
    quote?.changePct == null
      ? 'text-[var(--text-muted)]'
      : quoteIsPositive
        ? 'text-emerald-400'
        : 'text-rose-400'
  const marketStatus = useMemo(() => getVietnamMarketStatus(new Date(marketClock)), [marketClock])

  const healthBadge = useMemo(() => {
    if (connectionStatus === 'online') {
      return {
        label: 'Healthy',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        dotClassName: 'bg-emerald-400',
      }
    }
    if (connectionStatus === 'degraded' || connectionStatus === 'checking') {
      return {
        label: connectionStatus === 'checking' ? 'Checking' : 'Degraded',
        className: 'border-amber-500/35 bg-amber-500/10 text-amber-200',
        dotClassName: 'bg-amber-400',
      }
    }
    return {
      label: 'Offline',
      className: 'border-rose-500/35 bg-rose-500/10 text-rose-300',
      dotClassName: 'bg-rose-400',
    }
  }, [connectionStatus])

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

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(260px,420px)_auto] items-center gap-3 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="hidden items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] xl:flex">
            <span>VNIBB</span>
            <ChevronRight size={11} className="text-[var(--text-muted)]" />
            <span>Equities</span>
            <ChevronRight size={11} className="text-[var(--text-muted)]" />
            <span className="text-[var(--text-primary)]">{currentSymbol}</span>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {formatHeaderPrice(quote?.price)}
              </span>
              <span className={cn('text-xs font-semibold', quoteChangeClass)}>
                {formatHeaderPercent(quote?.changePct)}
              </span>
              {sparklinePoints && (
                <svg viewBox="0 0 100 28" className="h-6 w-20" aria-hidden="true">
                  <polyline
                    fill="none"
                    stroke={quoteIsPositive ? '#34d399' : '#f87171'}
                    strokeWidth="2"
                    points={sparklinePoints}
                  />
                </svg>
              )}
            </div>

            <div
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-1',
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
              <span className="sr-only">{healthBadge.label}</span>
            </div>
          </div>
        </div>

          <div className="relative w-full max-w-md justify-self-center">
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
              placeholder="Search symbol (e.g., VNM, FPT)"
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] py-1.5 pl-8 pr-10 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
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

        <div className="flex items-center gap-1 justify-self-end">
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
              <DropdownMenuItem onClick={toggleTheme} className="text-xs">
                Theme: {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
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
                {onAutoFitLayout && (
                  <DropdownMenuItem onClick={onAutoFitLayout} className="text-xs">
                    Auto-fit layout
                  </DropdownMenuItem>
                )}
                {onResetLayout && (
                  <DropdownMenuItem onClick={onResetLayout} className="text-xs">
                    Reset layout
                  </DropdownMenuItem>
                )}
                {onAIClick && (
                  <>
                    {(onAutoFitLayout || onResetLayout || onCollapseAll || onExpandAll || onEditToggle) && (
                      <DropdownMenuSeparator />
                    )}
                    <DropdownMenuItem onClick={onAIClick} className="text-xs">
                      Open AI assistant
                    </DropdownMenuItem>
                  </>
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
                {onEditToggle && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onEditToggle} className="text-xs">
                      {isEditing ? 'Lock Editing' : 'Unlock Editing'}
                    </DropdownMenuItem>
                  </>
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
    </header>
  )
}
