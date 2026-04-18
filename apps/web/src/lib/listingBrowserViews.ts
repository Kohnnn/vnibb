'use client'

export const LISTING_BROWSER_VIEWS_KEY = 'vnibb-listing-browser-views'

export interface ListingBrowserView {
  id: string
  name: string
  exchange: string
  group: string
  industry: string
  search: string
  updatedAt: string
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
