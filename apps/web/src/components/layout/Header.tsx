// Header component with market context and workspace controls

'use client'

import { useCallback, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import {
  LogOut,
  Search,
  User,
  MoreHorizontal,
  Lock,
  Sparkles,
  Unlock,
} from 'lucide-react'
import { VNIBB_BRAND_NAME, VniBBLogo } from '@/components/brand/VniBBLogo'
import { AlertNotificationPanel } from '../widgets/AlertNotificationPanel'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth, type AuthUser } from '@/contexts/AuthContext'
import { env } from '@/lib/env'
import { useHistoricalPrices, useMarketOverview, useStockQuote } from '@/lib/queries'
import { formatPercent, type UnitDisplay } from '@/lib/units'
import { priceArrow, priceColorClass } from '@/lib/priceColor'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const UNIT_OPTIONS: Array<{ value: UnitDisplay; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'K', label: 'K' },
  { value: 'M', label: 'M' },
  { value: 'B', label: 'B' },
  { value: 'USD', label: 'USD' },
  { value: 'raw', label: 'Raw' },
]

function getShortcutModifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘' : 'Ctrl'
}

function formatHeaderPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Arrow + signed percent. Shape (arrow) and sign carry direction so the
 * reading survives colour-vision mode; a measured zero stays `0.00%`.
 */
function formatHeaderMovement(value: number | null | undefined): string {
  const arrow = priceArrow(value)
  const percent = formatPercent(value, { decimals: 2, input: 'percent', signed: true })
  if (!arrow) return percent
  return `${arrow} ${percent}`
}

function normalizeIndexName(value: string | null | undefined): string {
  return String(value ?? '').replace(/[-_\s]/g, '').toUpperCase()
}

function getUserDisplayName(user: AuthUser | null): string {
  const metadataName = user?.user_metadata?.display_name || user?.user_metadata?.name
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim()
  if (user?.email) return user.email.split('@')[0]
  return 'Guest'
}

function getUserInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U'
}

interface HeaderProps {
  currentSymbol: string
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
  globalStatus?: ReactNode
}

export function Header({
  currentSymbol,
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
  globalStatus,
}: HeaderProps) {
  const hasActionMenu = Boolean(onResetLayout || onCollapseAll || onExpandAll)
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { user, loading: authLoading, provider, isAdmin, isGuest, signOut } = useAuth()
  const shortcutModifier = getShortcutModifierLabel()

  const quoteQuery = useStockQuote(currentSymbol, Boolean(currentSymbol))
  const marketOverviewQuery = useMarketOverview(true)
  const historyQuery = useHistoricalPrices(currentSymbol, {
    interval: '1D',
    enabled: Boolean(currentSymbol),
  })

  const quote = quoteQuery.data
  const displayQuoteChangePct = useMemo(() => {
    if (quote?.changePct != null) return quote.changePct

    const points = historyQuery.data?.data || []
    // The history fallback is only comparable when every row carries the same
    // explicit price unit; a response-level `unit_status` cannot certify
    // markerless rows (QA #98).
    const unitStatus = historyQuery.data?.meta?.unit_status ?? ''
    const expectedUnit = unitStatus === 'confirmed_vnd' ? 'VND' : 'index_points'
    const certified = points.length > 0
      && ['confirmed_vnd', 'index_points', 'not_applicable'].includes(unitStatus)
      && points.every((point) => point.price_unit === expectedUnit)
    if (!certified) return null

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
  }, [historyQuery.data?.data, historyQuery.data?.meta?.unit_status, quote?.changePct])

  // Token-backed price-direction classes (see lib/priceColor.ts + globals.css).
  // These adapt to light theme and colorblind mode automatically; the arrow
  // glyph and sign carry direction when hue is unavailable.
  const quoteChangeClass = priceColorClass(displayQuoteChangePct)
  const getIndexChangeClass = useCallback(
    (changePct: number | null | undefined) => priceColorClass(changePct),
    [],
  )
  const marketChips = useMemo(() => {
    const rows = marketOverviewQuery.data?.data || []
    const findIndex = (aliases: string[]) => rows.find((item) => aliases.includes(normalizeIndexName(item.index_name))) || null

    return [
      { label: 'VN-INDEX', data: findIndex(['VNINDEX']) },
      { label: 'VN30', data: findIndex(['VN30', 'VN30INDEX']) },
      { label: 'HNX', data: findIndex(['HNX', 'HNXINDEX']) },
    ]
  }, [marketOverviewQuery.data?.data])
  const showIndexSkeletons = marketOverviewQuery.isLoading && !marketOverviewQuery.data
  const authBypassEnabled = env.authBypassEnabled
  const userDisplayName = getUserDisplayName(user)
  const userInitials = getUserInitials(userDisplayName)
  const userRoleLabel = isAdmin ? 'Admin' : isGuest ? 'Guest' : user ? 'Member' : 'Signed out'

  const openHeaderSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent('vnibb:open-command-palette', {
      detail: { source: 'header_search' },
    }))
  }, [])

  return (
    <header className="relative z-30 border-b border-[var(--border-subtle)] bg-[var(--dashboard-shell-bg)]/95 isolate-auto">
      {/* Solid surface in a sibling absolutely-positioned layer so the header
          element itself does NOT establish a stacking context. A
          `backdrop-filter` here trapped any z-50 dropdown (Display Settings,
          AlertNotificationPanel) inside the header's paint order; the blur was
          retired in #199 (glass). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[var(--dashboard-shell-bg)]" />
      <div className="px-2 py-2 pl-[3.25rem] sm:pl-14 lg:px-4">
        <div data-tour="header-bar" className="flex min-h-11 min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap">
          {/* Below lg the sidebar is off-canvas, so the wordmark lives here. */}
          <Link
            href="/"
            aria-label={`${VNIBB_BRAND_NAME} home`}
            className="flex min-h-11 shrink-0 items-center rounded-sm lg:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
          >
            <VniBBLogo width={80} label={null} />
          </Link>
          <div className="hidden min-w-0 shrink-0 items-center gap-2 2xl:flex">
            <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  {currentSymbol}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {formatHeaderPrice(quote?.price)}
                  </span>
                  <span className={cn('text-xs font-semibold', quoteChangeClass)}>
                    {formatHeaderMovement(displayQuoteChangePct)}
                  </span>
                </div>
              </div>
            </div>
            {marketChips.map((chip) => (
              <div key={chip.label} className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--text-muted)]">
                    {chip.label}
                  </div>
                  {showIndexSkeletons ? (
                    <div className="mt-1 flex items-center gap-2" aria-label={`${chip.label} loading`}>
                      <span className="h-3 w-14 animate-pulse rounded bg-[var(--bg-hover)]" />
                      <span className="h-3 w-9 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {formatHeaderPrice(chip.data?.current_value)}
                      </span>
                      <span className={cn('text-xs font-semibold', getIndexChangeClass(chip.data?.change_pct))}>
                        {formatHeaderMovement(chip.data?.change_pct)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div data-tour="header-search" className="relative w-11 shrink-0 sm:min-w-0 sm:flex-1">
            <button
              type="button"
              aria-label="Open symbol search and command palette"
              onClick={openHeaderSearch}
              className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-[var(--border-strong)] bg-[var(--bg-secondary)] text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:justify-between sm:pl-8 sm:pr-3"
            >
              <Search
                className="text-[var(--text-muted)] sm:absolute sm:left-2.5 sm:top-1/2 sm:-translate-y-1/2"
                size={16}
              />
              <span className="hidden min-w-0 truncate text-[var(--text-secondary)] sm:block">
                Search tickers, commands, and workspaces
              </span>
              <span className="hidden shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] xl:inline-flex">
                {shortcutModifier}+K
              </span>
            </button>
          </div>

          <div data-tour="header-tools" className="ml-auto flex min-w-0 max-w-full shrink-0 items-center justify-end gap-1">

          {onAIClick && (
            <button
              type="button"
              onClick={onAIClick}
              className={cn(
                'hidden h-11 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:flex',
                isAIOpen
                  ? 'border-[var(--color-accent-primary)] bg-[var(--color-state-bg)] text-[var(--color-info)]'
                  : 'border-[var(--border-strong)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              )}
              title="Open VniAgent"
              aria-label={isAIOpen ? 'Close VniAgent' : 'Open VniAgent'}
              aria-pressed={isAIOpen}
            >
              <Sparkles size={13} />
              <span className="hidden md:inline">VniAgent</span>
            </button>
          )}

          {onEditToggle && (
            <button
              type="button"
              onClick={onEditToggle}
              aria-pressed={isEditing}
              className={cn(
                'hidden h-11 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] xl:inline-flex',
                isEditing
                  ? 'border-[var(--color-accent-primary)] bg-[var(--color-state-bg)] text-[var(--text-primary)]'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)]',
              )}
            >
              {isEditing ? <Unlock size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
              {isEditing ? 'Lock layout' : 'Edit layout'}
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid size-11 place-items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
                title="Dashboard options"
                aria-label="Dashboard options"
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">Display settings</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel className="text-xs text-[var(--text-muted)]">Theme</DropdownMenuLabel>
                  {(['dark', 'light'] as const).map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setTheme(option)}
                      className={cn(
                        'text-xs capitalize',
                        theme === option ? 'font-semibold text-[var(--color-info)]' : 'text-[var(--text-secondary)]'
                      )}
                    >
                      {option}
                    </DropdownMenuItem>
                  ))}
                  <div className="px-2 py-1 text-[10px] text-[var(--text-muted)]">Active: {resolvedTheme}</div>
                  {onUnitDisplayChange && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-[var(--text-muted)]">Unit display ({unitDisplay})</DropdownMenuLabel>
                      {UNIT_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => onUnitDisplayChange(option.value)}
                          className={cn(
                            'text-xs',
                            unitDisplay === option.value
                              ? 'font-semibold text-[var(--color-info)]'
                              : 'text-[var(--text-secondary)]'
                          )}
                        >
                          {option.label}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {onAIClick && (
                <DropdownMenuItem onClick={onAIClick} className="text-xs sm:hidden">
                  {isAIOpen ? 'Close VniAgent' : 'Open VniAgent'}
                </DropdownMenuItem>
              )}
              {onEditToggle && (
                <DropdownMenuItem onClick={onEditToggle} className="text-xs xl:hidden">
                  {isEditing ? 'Lock layout' : 'Edit layout'}
                </DropdownMenuItem>
              )}
              {onAutoFitLayout && (
                <DropdownMenuItem onClick={onAutoFitLayout} className="text-xs">Auto-fit layout</DropdownMenuItem>
              )}
              {hasActionMenu && <DropdownMenuSeparator />}
              {onResetLayout && (
                <DropdownMenuItem onClick={onResetLayout} className="text-xs">Reset layout</DropdownMenuItem>
              )}
              {onCollapseAll && (
                <DropdownMenuItem onClick={onCollapseAll} className="text-xs">Collapse all widgets</DropdownMenuItem>
              )}
              {onExpandAll && (
                <DropdownMenuItem onClick={onExpandAll} className="text-xs">Expand all widgets</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertNotificationPanel />
          {globalStatus}

          {(!authBypassEnabled || user) && (
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <button
                 type="button"
                 className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-tertiary)] px-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
                 title="Account menu"
                 aria-label="Open account menu"
               >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-secondary)] text-[10px] font-bold uppercase text-[var(--text-primary)]">
                  {authLoading ? <User size={13} /> : userInitials}
                </span>
                <span className="hidden max-w-[8rem] truncate text-[10px] font-semibold uppercase tracking-[0.12em] 2xl:inline">
                  {authLoading ? 'Session' : userDisplayName}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuItem className="flex-col items-start gap-1 text-xs focus:bg-transparent">
                <span className="font-semibold text-[var(--text-primary)]">
                  {authLoading ? 'Checking session' : userDisplayName}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {user?.email || (authLoading ? 'Loading account state' : 'No active account')}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs text-[var(--text-secondary)] focus:bg-transparent">
                {`${userRoleLabel} via ${provider}`}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => window.location.assign('/settings')}
                className="text-xs"
              >
                Settings
              </DropdownMenuItem>
              {user ? (
                <DropdownMenuItem
                  onClick={() => { void signOut() }}
                  className="text-xs text-[var(--text-secondary)]"
                >
                  <LogOut size={13} />
                  Sign out
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => window.location.assign('/login')}
                  className="text-xs"
                >
                  Sign in
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          )}
          </div>
        </div>
      </div>
    </header>
  )
}
