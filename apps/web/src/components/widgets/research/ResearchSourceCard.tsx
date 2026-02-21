'use client'

import { Clock3, Copy, ExternalLink } from 'lucide-react'

interface ResearchSourceCardProps {
  source: {
    id: string
    label: string
    url: string
    favicon?: string
    description?: string
    category: 'embed' | 'external' | 'rss'
  }
  symbol?: string
  onOpenExternal: (url: string) => void
  onCopyUrl?: (url: string) => void
  lastVisitedAt?: string | null
}

const CATEGORY_LABELS: Record<ResearchSourceCardProps['source']['category'], string> = {
  embed: 'Embeddable',
  external: 'Open in tab',
  rss: 'RSS + tab',
}

export function ResearchSourceCard({
  source,
  symbol,
  onOpenExternal,
  onCopyUrl,
  lastVisitedAt,
}: ResearchSourceCardProps) {
  const shortHost = (() => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {
      return source.url
    }
  })()

  const handleOpen = () => onOpenExternal(source.url)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpen()
        }
      }}
      className="group rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 transition-all hover:-translate-y-0.5 hover:border-blue-500/40 hover:shadow-[0_12px_28px_rgba(37,99,235,0.12)]"
      aria-label={`Open ${source.label} in a new tab`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-sm font-black text-[var(--text-secondary)]">
          {source.favicon ? (
            <img
              src={source.favicon}
              alt={`${source.label} favicon`}
              className="h-8 w-8 object-contain"
              loading="lazy"
            />
          ) : (
            <span>{source.label.slice(0, 1).toUpperCase()}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{source.label}</h3>
            <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {CATEGORY_LABELS[source.category]}
            </span>
          </div>

          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {source.description || `${source.label} research source for ${symbol || 'selected ticker'}.`}
          </p>

          <p className="mt-2 truncate text-[11px] text-[var(--text-muted)]">{shortHost}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (onCopyUrl) {
                onCopyUrl(source.url)
              }
            }}
            className="rounded border border-[var(--border-color)] p-2 text-[var(--text-muted)] transition-colors hover:border-blue-500/40 hover:text-[var(--text-primary)]"
            title="Copy URL"
            aria-label="Copy source URL"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleOpen()
            }}
            className="inline-flex items-center gap-1 rounded border border-blue-500/50 bg-blue-600/10 px-2.5 py-2 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-600/20"
            aria-label={`Open ${source.label}`}
          >
            <ExternalLink size={13} />
            Open in Tab
          </button>
        </div>
      </div>

      {lastVisitedAt && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2 text-[10px] text-[var(--text-muted)]">
          <Clock3 size={11} />
          Last visited {new Date(lastVisitedAt).toLocaleString()}
        </div>
      )}
    </article>
  )
}

export default ResearchSourceCard
