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
 *  - On subsequent state changes, writes params with `replaceState` (no history
 *    spam). Browser back/forward updates are picked up via `popstate`.
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

      if (urlDashboard && dashboardIds.includes(urlDashboard) && urlDashboard !== activeDashboardId) {
        applyDashboard(urlDashboard);
        applied = true;
        if (urlTab && getTabIds(urlDashboard).includes(urlTab)) {
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
      window.history.replaceState(window.history.state, '', next);
    }
  }, [ready, activeDashboardId, activeTabId, symbol]);
}
