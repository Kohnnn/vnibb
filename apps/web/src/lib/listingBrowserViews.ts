'use client'

export const LISTING_BROWSER_VIEWS_KEY = 'vnibb-listing-browser-views'

export interface ListingBrowserView {
  id: string
  name: string
  exchange: string
  group: string
  industry: string
  search: string
  sortMode?: string
  updatedAt: string
}

export interface ListingBrowserViewInput {
  exchange: string
  group: string
  industry: string
  search: string
  sortMode: string
}

export function buildListingBrowserViewName(view: ListingBrowserViewInput): string {
  const parts = [view.exchange === 'ALL' ? 'All exchanges' : view.exchange]

  if (view.group !== 'ALL') parts.push(view.group)
  if (view.industry !== 'ALL') parts.push(view.industry)
  if (view.search.trim()) parts.push(`Search: ${view.search.trim()}`)
  if (view.sortMode !== 'symbol') parts.push(`Sort: ${view.sortMode}`)

  return parts.join(' • ')
}

export function buildListingBrowserFilterSummary(view: ListingBrowserViewInput): string {
  const filters = [view.exchange === 'ALL' ? 'all exchanges' : view.exchange]

  filters.push(view.group === 'ALL' ? 'all groups' : view.group)
  filters.push(view.industry === 'ALL' ? 'all industries' : view.industry)

  if (view.search.trim()) filters.push(`matching "${view.search.trim()}"`)

  return `Showing ${filters.join(', ')}. Sorted by ${view.sortMode}.`
}

export function readListingBrowserViews(): ListingBrowserView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LISTING_BROWSER_VIEWS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as ListingBrowserView[] : []
  } catch {
    return []
  }
}

export function writeListingBrowserViews(views: ListingBrowserView[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LISTING_BROWSER_VIEWS_KEY, JSON.stringify(views.slice(0, 8)))
}

export function saveListingBrowserView(view: ListingBrowserView): ListingBrowserView[] {
  const next = [view, ...readListingBrowserViews().filter((item) => item.id !== view.id)].slice(0, 8)
  writeListingBrowserViews(next)
  return next
}

export function removeListingBrowserView(id: string): ListingBrowserView[] {
  const next = readListingBrowserViews().filter((item) => item.id !== id)
  writeListingBrowserViews(next)
  return next
}
