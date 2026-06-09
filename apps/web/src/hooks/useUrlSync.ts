'use client';

/**
 * URL deep-linking for the dashboard workspace.
 *
 * Reflects the active dashboard / tab / symbol in the URL query string so views
 * are shareable, bookmarkable, and navigable with the browser back/forward
 * buttons. Implemented with the History API directly (not Next's
 * `useSearchParams`) to avoid forcing a Suspense boundary and to keep all sync
 * logic self-contained instead of threaded through the large DashboardContext.
 *
 * Query params: `?dashboard=<id>&tab=<id>&symbol=<TICKER>`
 *
 * Behavior:
 *  - On first mount, reads params and applies them once (deep-link restore).
 *    This runs after the context has restored its own persisted state, and
 *    only overrides when the URL actually specifies something valid.
 *  - On subsequent state changes, writes params with `replaceState` only (never
 *    pushState). This keeps the URL shareable without creating extra history
 *    entries that the Next App Router cannot reconcile (which caused a blank
 *    screen on browser Back — DEF-15).
 */

import { useCallback, useEffect, useRef } from 'react';

interface UseUrlSyncParams {
  /** Whether the host has mounted + context state has been restored. */
  ready: boolean;
  activeDashboardId: string | null;
  activeTabId: string | null;
  symbol: string;
  /** Valid dashboard ids, used to ignore stale/invalid deep links. */
  dashboardIds: string[];
  /** Returns valid tab ids for a dashboard id (for deep-link validation). */
  getTabIds: (dashboardId: string) => string[];
  applyDashboard: (id: string) => void;
  applyTab: (id: string) => void;
  applySymbol: (symbol: string) => void;
}

const PARAM_DASHBOARD = 'dashboard';
const PARAM_TAB = 'tab';
const PARAM_SYMBOL = 'symbol';

/**
 * Back-compat aliases for dashboard slugs. Older share/bookmark links (and some
 * docs) used short slugs that don't match the canonical dashboard ids. Map them
 * so deep-links resolve instead of silently falling back to the default
 * dashboard. (DEF-02: `default-global` → `default-global-markets`.)
 */
const DASHBOARD_SLUG_ALIASES: Record<string, string> = {
  'default-global': 'default-global-markets',
  'global': 'default-global-markets',
  'global-markets': 'default-global-markets',
  'fundamental': 'default-fundamental',
  'technical': 'default-technical',
  'quant': 'default-quant',
};

const resolveDashboardSlug = (slug: string, validIds: string[]): string | null => {
  if (validIds.includes(slug)) return slug;
  const aliased = DASHBOARD_SLUG_ALIASES[slug];
  if (aliased && validIds.includes(aliased)) return aliased;
  return null;
};

/** Exported for unit testing the slug-alias resolution (DEF-02). */
export const __resolveDashboardSlug = resolveDashboardSlug;

export function useUrlSync({
  ready,
  activeDashboardId,
  activeTabId,
  symbol,
  dashboardIds,
  getTabIds,
  applyDashboard,
  applyTab,
  applySymbol,
}: UseUrlSyncParams) {
  const hasRestoredRef = useRef(false);
  // Suppress the write-effect for one cycle right after we apply an inbound
  // URL change (deep-link restore or popstate), so we don't immediately
  // overwrite the URL we just read from.
  const suppressWriteRef = useRef(false);

  const applyFromSearch = useCallback(
    (search: string) => {
      const params = new URLSearchParams(search);
      const urlDashboard = params.get(PARAM_DASHBOARD);
      const urlTab = params.get(PARAM_TAB);
      const urlSymbol = params.get(PARAM_SYMBOL);

      let applied = false;

      const resolvedDashboard = urlDashboard
        ? resolveDashboardSlug(urlDashboard, dashboardIds)
        : null;

      if (resolvedDashboard && resolvedDashboard !== activeDashboardId) {
        applyDashboard(resolvedDashboard);
        applied = true;
        if (urlTab && getTabIds(resolvedDashboard).includes(urlTab)) {
          applyTab(urlTab);
        }
      } else if (
        urlTab &&
        activeDashboardId &&
        getTabIds(activeDashboardId).includes(urlTab) &&
        urlTab !== activeTabId
      ) {
        applyTab(urlTab);
        applied = true;
      }

      if (urlSymbol) {
        const normalized = urlSymbol.trim().toUpperCase();
        if (normalized && normalized !== symbol.toUpperCase()) {
          applySymbol(normalized);
          applied = true;
        }
      }

      return applied;
    },
    [
      activeDashboardId,
      activeTabId,
      symbol,
      dashboardIds,
      getTabIds,
      applyDashboard,
      applyTab,
      applySymbol,
    ],
  );

  // One-time deep-link restore on mount.
  useEffect(() => {
    if (!ready || hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    if (typeof window === 'undefined') return;

    const applied = applyFromSearch(window.location.search);
    if (applied) {
      suppressWriteRef.current = true;
    }
  }, [ready, applyFromSearch]);

  // Browser back/forward.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      suppressWriteRef.current = true;
      applyFromSearch(window.location.search);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyFromSearch]);

  // Write current state into the URL when it changes.
  useEffect(() => {
    if (!ready || !hasRestoredRef.current) return;
    if (typeof window === 'undefined') return;

    if (suppressWriteRef.current) {
      suppressWriteRef.current = false;
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (activeDashboardId) {
      params.set(PARAM_DASHBOARD, activeDashboardId);
    } else {
      params.delete(PARAM_DASHBOARD);
    }
    if (activeTabId) {
      params.set(PARAM_TAB, activeTabId);
    } else {
      params.delete(PARAM_TAB);
    }
    if (symbol) {
      params.set(PARAM_SYMBOL, symbol.toUpperCase());
    } else {
      params.delete(PARAM_SYMBOL);
    }

    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      // IMPORTANT: only ever `replaceState`, never `pushState`.
      //
      // Next.js App Router owns the History API + the popstate event. Pushing
      // our own entries created phantom history that Next could not reconcile,
      // so a browser Back triggered a full route re-render with a multi-second
      // blank screen (DEF-15). replaceState updates the URL of the *current*
      // entry only — keeping deep-links shareable/bookmarkable — without adding
      // navigations that confuse the router. Browser Back/Forward then behaves
      // as normal document navigation.
      window.history.replaceState(window.history.state, '', next);
    }
  }, [ready, activeDashboardId, activeTabId, symbol]);
}
