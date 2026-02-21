'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookmarkPlus,
  ExternalLink,
  Globe,
  Link2,
  Plus,
  RefreshCcw,
  Rss,
  Search,
  Trash2,
} from 'lucide-react'

import { WidgetContainer } from '@/components/ui/WidgetContainer'
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useTouchGestures } from '@/hooks/useTouchGestures'
import {
  getResearchRssFeed,
  type ResearchRssSource,
  type ResearchRssFeedResponse,
} from '@/lib/api'
import { useLocalStorage } from '@/lib/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import { ResearchSourceCard } from '@/components/widgets/research/ResearchSourceCard'

interface ResearchBrowserWidgetProps {
  id: string
  symbol?: string
  onRemove?: () => void
}

type SourceMode = 'embed' | 'external' | 'rss'
type SourceCategory = 'research' | 'broker' | 'chart' | 'global'

interface QuickSource {
  id: string
  label: string
  mode: SourceMode
  category: SourceCategory
  urlTemplate: string
  description: string
  favicon?: string
  rssSource?: ResearchRssSource
}

interface SavedSite {
  id: string
  title: string
  url: string
  createdAt: string
}

const QUICK_SOURCES: QuickSource[] = [
  {
    id: 'stockbiz',
    label: 'StockBiz',
    mode: 'embed',
    category: 'research',
    urlTemplate: 'https://stockbiz.vn/symbol/{SYMBOL}',
    description: 'Company profile, trading overview, and quick fundamentals.',
    favicon: 'https://stockbiz.vn/favicon.ico',
  },
  {
    id: 'cafef',
    label: 'CafeF',
    mode: 'rss',
    category: 'research',
    urlTemplate: 'https://s.cafef.vn/Pha-san-chi-tiet/{SYMBOL}/lich-su-gia.chn',
    description: 'Market coverage and article feed for Vietnam equities.',
    favicon: 'https://cafef.vn/favicon.ico',
    rssSource: 'cafef',
  },
  {
    id: 'vietstock',
    label: 'Vietstock',
    mode: 'rss',
    category: 'research',
    urlTemplate: 'https://finance.vietstock.vn/{SYMBOL}/financials.htm',
    description: 'Financial statements and market commentary.',
    favicon: 'https://vietstock.vn/favicon.ico',
    rssSource: 'vietstock',
  },
  {
    id: 'fireant',
    label: 'FireAnt',
    mode: 'external',
    category: 'research',
    urlTemplate: 'https://fireant.vn/symbol/{SYMBOL}',
    description: 'Community data and rich charting tools.',
    favicon: 'https://fireant.vn/favicon.ico',
  },
  {
    id: 'simplize',
    label: 'Simplize',
    mode: 'external',
    category: 'research',
    urlTemplate: 'https://simplize.vn/co-phieu/{SYMBOL}',
    description: 'Stock analytics and profile cards for listed companies.',
    favicon: 'https://simplize.vn/favicon.ico',
  },
  {
    id: 'vndirect',
    label: 'VNDirect',
    mode: 'external',
    category: 'broker',
    urlTemplate: 'https://www.vndirect.com.vn/co-phieu/{SYMBOL}',
    description: 'Broker-native research pages and ticker snapshots.',
    favicon: 'https://www.vndirect.com.vn/favicon.ico',
  },
  {
    id: 'tradingview',
    label: 'TradingView',
    mode: 'external',
    category: 'chart',
    urlTemplate: 'https://www.tradingview.com/chart/?symbol=HOSE:{SYMBOL}',
    description: 'Advanced charting and technical overlays.',
    favicon: 'https://www.tradingview.com/favicon.ico',
  },
  {
    id: 'investing',
    label: 'Investing.com',
    mode: 'external',
    category: 'global',
    urlTemplate: 'https://www.investing.com/search/?q={SYMBOL}',
    description: 'Global context and macro reference coverage.',
    favicon: 'https://www.investing.com/favicon.ico',
  },
]

const EMBED_BLOCKLIST: Record<string, string> = {
  'cafef.vn': 'CafeF blocks iframe embedding with X-Frame-Options.',
  'fireant.vn': 'FireAnt blocks embedding for authenticated and public pages.',
  'vietstock.vn': 'Vietstock blocks most iframe embeds.',
  'vndirect.com.vn': 'VNDirect pages are protected against iframe embedding.',
  'google.com': 'Google search pages cannot be embedded in iframes.',
}

const CATEGORY_LABELS: Record<SourceCategory, string> = {
  research: 'Research',
  broker: 'Broker',
  chart: 'Chart',
  global: 'Global',
}

function normalizeUrl(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return `https://${value}`
}

function substituteSymbol(urlTemplate: string, symbol?: string): string {
  if (!symbol) return urlTemplate.replaceAll('{SYMBOL}', '').replaceAll('{symbol}', '')
  const normalized = encodeURIComponent(symbol.trim().toUpperCase())
  return urlTemplate.replaceAll('{SYMBOL}', normalized).replaceAll('{symbol}', normalized)
}

function getEmbedBlockReason(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const blocked = Object.entries(EMBED_BLOCKLIST).find(
      ([domain]) => host === domain || host.endsWith(`.${domain}`)
    )
    return blocked ? blocked[1] : null
  } catch {
    return 'Invalid URL.'
  }
}

function inferRssSource(source?: QuickSource | null): ResearchRssSource | null {
  if (!source) return null
  if (source.rssSource) return source.rssSource
  return source.mode === 'rss' ? (source.id as ResearchRssSource) : null
}

export function ResearchBrowserWidget({ id, symbol, onRemove }: ResearchBrowserWidgetProps) {
  const [activeSourceId, setActiveSourceId] = useLocalStorage<string>(
    `vnibb_research_source_${id}`,
    'stockbiz'
  )
  const [savedSites, setSavedSites] = useLocalStorage<SavedSite[]>(`vnibb_research_saved_${id}`, [])
  const [activeSavedSiteId, setActiveSavedSiteId] = useLocalStorage<string | null>(
    `vnibb_research_saved_active_${id}`,
    null
  )
  const [lastVisitedByUrl, setLastVisitedByUrl] = useLocalStorage<Record<string, string>>(
    `vnibb_research_last_visited_${id}`,
    {}
  )

  const [customTitle, setCustomTitle] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [embedState, setEmbedState] = useState<'idle' | 'loading' | 'ready' | 'blocked'>('idle')
  const [inlineNotice, setInlineNotice] = useState<string | null>(null)

  const normalizedSymbol = (symbol || '').trim().toUpperCase()
  const activeQuickSource = useMemo(
    () => QUICK_SOURCES.find((source) => source.id === activeSourceId) || QUICK_SOURCES[0],
    [activeSourceId]
  )
  const activeSavedSite = useMemo(
    () => savedSites.find((site) => site.id === activeSavedSiteId) || null,
    [savedSites, activeSavedSiteId]
  )

  const activeUrl = useMemo(() => {
    if (activeSavedSite) return activeSavedSite.url
    return substituteSymbol(activeQuickSource.urlTemplate, normalizedSymbol)
  }, [activeSavedSite, activeQuickSource.urlTemplate, normalizedSymbol])

  const activeTitle = activeSavedSite?.title || activeQuickSource.label
  const activeMode: SourceMode = activeSavedSite ? 'embed' : activeQuickSource.mode
  const embedBlockReason = useMemo(() => getEmbedBlockReason(activeUrl), [activeUrl])
  const canAttemptEmbed = activeMode === 'embed' && Boolean(activeUrl) && !embedBlockReason
  const rssSource = activeSavedSite ? null : inferRssSource(activeQuickSource)

  const groupedSources = useMemo(() => {
    return QUICK_SOURCES.reduce<Record<SourceCategory, QuickSource[]>>(
      (acc, source) => {
        acc[source.category].push(source)
        return acc
      },
      { research: [], broker: [], chart: [], global: [] }
    )
  }, [])

  const sourceOrder = useMemo(() => QUICK_SOURCES.map((source) => source.id), [])

  const markVisited = useCallback(
    (url: string) => {
      const stamp = new Date().toISOString()
      setLastVisitedByUrl((prev) => ({ ...prev, [url]: stamp }))
    },
    [setLastVisitedByUrl]
  )

  const openExternal = useCallback(
    (url: string) => {
      if (!url) return
      window.open(url, '_blank', 'noopener,noreferrer')
      markVisited(url)
      if (activeSavedSite) {
        setSavedSites((prev) =>
          prev.map((site) => (site.id === activeSavedSite.id ? { ...site, url } : site))
        )
      }
    },
    [markVisited, activeSavedSite, setSavedSites]
  )

  const copyUrl = useCallback((url: string) => {
    if (!url) return
    navigator.clipboard
      .writeText(url)
      .then(() => setInlineNotice('URL copied to clipboard.'))
      .catch(() => setInlineNotice('Could not copy URL in this browser.'))
  }, [])

  const addCustomSite = useCallback(() => {
    const normalized = normalizeUrl(customUrl)
    if (!normalized) return

    const existing = savedSites.find((site) => site.url === normalized)
    if (existing) {
      setActiveSavedSiteId(existing.id)
      setCustomTitle('')
      setCustomUrl('')
      setInlineNotice(`Using existing saved source: ${existing.title}`)
      return
    }

    const next: SavedSite = {
      id: `site-${Date.now()}`,
      title: customTitle.trim() || normalized.replace(/^https?:\/\//, ''),
      url: normalized,
      createdAt: new Date().toISOString(),
    }

    setSavedSites((prev) => [next, ...prev])
    setActiveSavedSiteId(next.id)
    setCustomTitle('')
    setCustomUrl('')
    setInlineNotice('Custom source saved.')
  }, [customUrl, customTitle, savedSites, setSavedSites, setActiveSavedSiteId])

  const removeSavedSite = useCallback(
    (siteId: string) => {
      setSavedSites((prev) => prev.filter((site) => site.id !== siteId))
      if (activeSavedSiteId === siteId) {
        setActiveSavedSiteId(null)
      }
    },
    [activeSavedSiteId, setSavedSites, setActiveSavedSiteId]
  )

  const bookmarkCurrent = useCallback(() => {
    if (!activeUrl) return

    const existing = savedSites.find((site) => site.url === activeUrl)
    if (existing) {
      setActiveSavedSiteId(existing.id)
      setInlineNotice('Already bookmarked. Opened saved source.')
      return
    }

    const entry: SavedSite = {
      id: `site-${Date.now()}`,
      title: activeTitle,
      url: activeUrl,
      createdAt: new Date().toISOString(),
    }

    setSavedSites((prev) => [entry, ...prev])
    setActiveSavedSiteId(entry.id)
    setInlineNotice('Current source bookmarked.')
  }, [activeTitle, activeUrl, savedSites, setActiveSavedSiteId, setSavedSites])

  const switchSource = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = sourceOrder.indexOf(activeSourceId)
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      const nextIndex = (baseIndex + direction + sourceOrder.length) % sourceOrder.length
      const nextId = sourceOrder[nextIndex]
      setActiveSourceId(nextId)
      setActiveSavedSiteId(null)
    },
    [activeSourceId, sourceOrder, setActiveSourceId, setActiveSavedSiteId]
  )

  const swipeHandlers = useTouchGestures({
    onSwipeLeft: () => switchSource(1),
    onSwipeRight: () => switchSource(-1),
  })

  useEffect(() => {
    if (!inlineNotice) return
    const timeoutId = window.setTimeout(() => setInlineNotice(null), 2200)
    return () => window.clearTimeout(timeoutId)
  }, [inlineNotice])

  useEffect(() => {
    if (!activeUrl) {
      setEmbedState('idle')
      return
    }

    if (!canAttemptEmbed) {
      setEmbedState('blocked')
      return
    }

    setEmbedState('loading')
    const timeoutId = window.setTimeout(() => {
      setEmbedState((current) => (current === 'ready' ? current : 'blocked'))
    }, 7000)

    return () => window.clearTimeout(timeoutId)
  }, [activeUrl, canAttemptEmbed])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openExternal(activeUrl)
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        switchSource(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        switchSource(1)
      }
    }

    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [activeUrl, openExternal, switchSource])

  const rssQuery = useQuery<ResearchRssFeedResponse>({
    queryKey: ['research-rss-feed', rssSource],
    queryFn: () => getResearchRssFeed(rssSource as ResearchRssSource, 8),
    enabled: Boolean(rssSource),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  })

  return (
    <WidgetContainer title="Research Browser" onClose={onRemove} noPadding widgetId={id}>
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]" {...swipeHandlers}>
        <div className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/80 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <Search size={12} />
              Source
            </div>

            <select
              value={activeSourceId}
              onChange={(event) => {
                setActiveSourceId(event.target.value)
                setActiveSavedSiteId(null)
              }}
              className="min-w-[210px] rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500/50"
              aria-label="Select research source"
            >
              {(Object.keys(groupedSources) as SourceCategory[]).map((category) => (
                <optgroup key={category} label={CATEGORY_LABELS[category]}>
                  {groupedSources[category].map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <button
              type="button"
              onClick={bookmarkCurrent}
              className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-blue-500/40 hover:text-[var(--text-primary)]"
            >
              <BookmarkPlus size={13} />
              Bookmark
            </button>

            <button
              type="button"
              onClick={() => openExternal(activeUrl)}
              className="inline-flex items-center gap-1 rounded border border-blue-500/50 bg-blue-600/10 px-2 py-1.5 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-600/20"
            >
              <ExternalLink size={13} />
              Open in Tab
            </button>

            <button
              type="button"
              onClick={() => {
                if (canAttemptEmbed) {
                  setEmbedState('loading')
                }
                rssQuery.refetch()
              }}
              className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              title="Refresh source"
            >
              <RefreshCcw size={12} />
              Refresh
            </button>

            <div className="ml-auto">
              <WidgetMeta
                note={normalizedSymbol ? `Ticker ${normalizedSymbol}` : 'No ticker selected'}
                align="right"
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={customTitle}
              onChange={(event) => setCustomTitle(event.target.value)}
              placeholder="Custom title"
              className="w-36 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500/50"
              aria-label="Custom source title"
            />
            <input
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addCustomSite()
                }
              }}
              placeholder="https://custom-site.example"
              className="min-w-[240px] flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500/50"
              aria-label="Custom source URL"
            />
            <button
              type="button"
              onClick={addCustomSite}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <Plus size={12} />
              Add URL
            </button>
          </div>

          {inlineNotice && <div className="mt-2 text-[11px] text-blue-300">{inlineNotice}</div>}
        </div>

        <div className="grid h-full grid-cols-1 lg:grid-cols-[250px_1fr]">
          <aside className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-3 lg:border-b-0 lg:border-r">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Saved Sources
            </div>

            {savedSites.length === 0 ? (
              <WidgetEmpty message="Bookmark or add custom URLs to build your source list." icon={<Globe size={16} />} />
            ) : (
              <div className="space-y-2">
                {savedSites.map((site) => {
                  const isActive = site.id === activeSavedSiteId
                  return (
                    <div
                      key={site.id}
                      className={cn(
                        'flex items-center gap-2 rounded border px-2 py-1.5',
                        isActive
                          ? 'border-blue-500/50 bg-blue-600/10'
                          : 'border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-blue-500/30'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveSavedSiteId(site.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">{site.title}</div>
                        <div className="truncate text-[10px] text-[var(--text-muted)]">
                          {site.url.replace(/^https?:\/\//, '')}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSavedSite(site.id)}
                        className="rounded p-1 text-[var(--text-muted)] transition-colors hover:text-red-400"
                        aria-label={`Delete saved source ${site.title}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-3 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-2 text-[10px] text-[var(--text-muted)]">
              <div className="font-semibold text-[var(--text-secondary)]">Shortcuts</div>
              <div className="mt-1">Ctrl+O open source in tab</div>
              <div>Arrow left/right switch source</div>
              <div>Swipe left/right on mobile</div>
            </div>
          </aside>

          <section className="min-h-[320px] bg-[var(--bg-primary)] p-3">
            {!activeUrl ? (
              <WidgetEmpty message="Pick a source to begin research." icon={<Link2 size={18} />} />
            ) : canAttemptEmbed && embedState !== 'blocked' ? (
              <div className="relative h-full min-h-[320px] overflow-hidden rounded-xl border border-[var(--border-color)]">
                <iframe
                  title={activeTitle}
                  src={activeUrl}
                  className="h-full w-full border-0 bg-[var(--bg-secondary)]"
                  loading="lazy"
                  onLoad={() => {
                    setEmbedState('ready')
                    markVisited(activeUrl)
                  }}
                />

                {embedState === 'loading' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/65 text-xs text-[var(--text-secondary)]">
                    Attempting embed...
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <ResearchSourceCard
                  source={{
                    id: activeSavedSite?.id || activeQuickSource.id,
                    label: activeTitle,
                    url: activeUrl,
                    favicon: activeSavedSite ? undefined : activeQuickSource.favicon,
                    description: activeSavedSite
                      ? 'Custom source. Open externally when embedding fails.'
                      : activeQuickSource.description,
                    category: activeMode,
                  }}
                  symbol={normalizedSymbol || undefined}
                  onOpenExternal={openExternal}
                  onCopyUrl={copyUrl}
                  lastVisitedAt={lastVisitedByUrl[activeUrl]}
                />

                {embedBlockReason && (
                  <div className="rounded border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    {embedBlockReason}
                  </div>
                )}

                {rssSource && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                      <Rss size={14} />
                      Live headlines ({rssSource})
                    </div>

                    {rssQuery.isLoading ? (
                      <div className="text-xs text-[var(--text-muted)]">Loading RSS headlines...</div>
                    ) : rssQuery.error ? (
                      <WidgetError error={rssQuery.error as Error} onRetry={() => rssQuery.refetch()} />
                    ) : rssQuery.data?.error ? (
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        RSS feed temporarily unavailable for {rssSource}. You can still open the source directly.
                      </div>
                    ) : !rssQuery.data || rssQuery.data.count === 0 ? (
                      <WidgetEmpty message="No RSS items available right now." />
                    ) : (
                      <div className="space-y-2">
                        {rssQuery.data.data.map((item) => (
                          <a
                            key={item.url}
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => markVisited(item.url)}
                            className="block rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-2 transition-colors hover:border-blue-500/40"
                          >
                            <div className="line-clamp-2 text-xs font-semibold text-[var(--text-primary)]">
                              {item.title}
                            </div>
                            {item.description && (
                              <div className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">
                                {item.description}
                              </div>
                            )}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </WidgetContainer>
  )
}

export default ResearchBrowserWidget
