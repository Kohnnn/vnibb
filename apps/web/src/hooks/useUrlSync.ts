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
 *  - An inbound URL (deep link or Back/Forward) wins until the state it asked
 *    for is actually on screen (#102). State updates are committed
 *    asynchronously, so without that hold the write effect published the
 *    *pre-apply* state over the URL it had just read, erasing `?tab=` and
 *    leaving the body on a no-tab spinner.
 *
 * All effects depend only on values that actually describe the view
 * (`ready`, the workspace list, the resolved tab). The apply callbacks are read
 * through a ref so a host that rebuilds them per render (as DashboardClient
 * does, because they close over `state.dashboards`) cannot make these effects
 * re-run on every render (#102 fresh-profile churn).
 */

import { useCallback, useEffect, useRef } from 'react';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';

interface UseUrlSyncParams {
  /** Whether the host has mounted + context state has been restored. */
  ready: boolean;
  activeDashboardId: string | null;
  activeTabId: string | null;
  symbol: string;
  /** Valid dashboard ids, used to ignore stale/invalid deep links. */
  dashboardIds: string[];
  /**
   * Resolves a URL tab slug to an actual tab id for a dashboard (#102). The URL
   * may carry a stable preference slug (e.g. `news-events`) that is not a raw
   * tab id; the host resolves it by id then normalized tab name.
   */
  resolveTabId: (dashboardId: string, slug: string) => string | null;
  /**
   * Increments only on a genuine user selection (#102). Captured when an
   * inbound URL is applied; if it advances before that state lands, the user
   * took over and the URL hold is released. Programmatic writes (bundled
   * seeding, backend snapshot, the hook's own apply) never bump it.
   */
  userNavigationSeq: number;
  applyDashboard: (id: string, options?: { programmatic?: boolean }) => void;
  applyTab: (id: string, options?: { programmatic?: boolean }) => void;
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
  resolveTabId,
  userNavigationSeq,
  applyDashboard,
  applyTab,
  applySymbol,
}: UseUrlSyncParams) {
  const hasRestoredRef = useRef(false);
  const pendingSymbolRef = useRef<{ dashboardId: string | null; symbol: string; applied: boolean } | null>(null);
  // #102: the inbound URL that was applied but whose state has not landed yet.
  // The write effect publishes the live state into the address bar and the
  // applied state arrives in a later commit; publishing in between overwrote the
  // deep-linked `?tab=` with the pre-apply tab — the reported "URL loses its tab
  // parameter and the body spins forever" symptom. The hold is released as soon
  // as the requested workspace/tab is active, when the user navigates
  // (userNavigationSeq), or when the URL moves on for another reason.
  const intentRef = useRef<{
    href: string;
    dashboardId: string | null;
    /** `null` when the URL named no tab (the dashboard resolves its own). */
    tabId: string | null;
    capturedSeq: number;
  } | null>(null);
  // A deep link whose workspace has not hydrated yet. Published layouts (and the
  // backend snapshot) land after the first paint, so the request is held rather
  // than dropped.
  const requestedRef = useRef<
    | { dashboard: string | null; tab: string | null; symbol: string | null; capturedSeq: number }
    | null
  >(null);
  // A URL tab slug that named a real tab *later* than the workspace itself —
  // e.g. `?dashboard=default-fundamental&tab=news-events`, where `news-events`
  // is a published tab. The workspace is applied immediately (so the body never
  // sits on a no-tab spinner) and the slug is applied once it registers. If it
  // never registers the live (valid) tab stands and the write effect republishes
  // it, so a genuinely invalid slug cannot leave a stale `?tab=` behind.
  const deferredTabRef = useRef<{ dashboardId: string; slug: string; capturedSeq: number } | null>(null);

  const applyFromSearch = useCallback(
    (search: string) => {
      const params = new URLSearchParams(search);
      const urlDashboard = params.get(PARAM_DASHBOARD);
      const urlTab = params.get(PARAM_TAB);
      const urlSymbol = params.get(PARAM_SYMBOL);
      pendingSymbolRef.current = null;

      let applied =false;
      let targetDashboardId: string | null = null;
      let targetTabId: string | null = null;

      const resolvedDashboard = urlDashboard
        ? resolveDashboardSlug(urlDashboard, dashboardIds)
        : null;
      // Resolve the URL tab slug to a real tab id for the target dashboard.
      const resolvedTab = urlTab && resolvedDashboard
        ? resolveTabId(resolvedDashboard, urlTab)
        : urlTab && activeDashboardId
          ? resolveTabId(activeDashboardId, urlTab)
          : null;

      if (resolvedDashboard && resolvedDashboard !== activeDashboardId) {
        applyDashboard(resolvedDashboard, { programmatic:true });
        applied =true;
        targetDashboardId = resolvedDashboard;
        // A resolvable named tab is the target; a URL without `tab` leaves the
        // tab to the dashboard's own remembered/first-tab resolution.
        targetTabId = resolvedTab;
        // #102: selecting the workspace alone is not enough — the workspace
        // resolves its *remembered* tab, not the one the URL named, and the
        // intent hold waits for the named tab to become active. Apply the
        // resolved tab in the same pass so the URL keeps its `tab` and the body
        // never lands on the wrong tab. When the slug is not resolvable yet the
        // tab stays null and the deferred effect applies it on registration.
        if (resolvedTab) applyTab(resolvedTab, { programmatic:true });
      } else if (activeDashboardId && resolvedTab && resolvedTab !== activeTabId) {
        applyTab(resolvedTab, { programmatic:true });
        applied =true;
        targetDashboardId = activeDashboardId;
        targetTabId = resolvedTab;
      }

      const normalized = normalizeTickerSymbol(urlSymbol);
      if (normalized) {
        const symbolDashboardId = resolvedDashboard ?? activeDashboardId;
        if (symbolDashboardId !== activeDashboardId || normalized !== symbol.toUpperCase()) {
          const scopeIsActive = symbolDashboardId === activeDashboardId;
          pendingSymbolRef.current = { dashboardId: symbolDashboardId, symbol: normalized, applied: scopeIsActive };
          if (scopeIsActive) applySymbol(normalized);
          applied =true;
          targetDashboardId = targetDashboardId ?? symbolDashboardId;
        }
      }

      if (applied) {
        intentRef.current = {
          href: window.location.href,
          dashboardId: targetDashboardId,
          tabId: targetTabId,
          capturedSeq: userNavigationSeq,
        };
      }

      return applied;
    },
    [
      activeDashboardId,
      activeTabId,
      symbol,
      dashboardIds,
      resolveTabId,
      userNavigationSeq,
      applyDashboard,
      applyTab,
      applySymbol,
    ],
  );

  // Latest apply, read through a ref: the effects below must re-run when the
  // view description changes, not when a host rebuilds its callbacks. The ref
  // is refreshed in an effect declared *before* its readers, so every reader
  // sees the callbacks from the current commit (and the initial render's
  // callbacks via the `useRef` initializer).
  const applyFromSearchRef = useRef(applyFromSearch);
  useEffect(() => {
    applyFromSearchRef.current = applyFromSearch;
  }, [applyFromSearch]);

  // Deep-link restore.
  //
  // #102: on a fresh profile the URL is the only source of truth for which
  // workspace to open, but the app hydrates asynchronously — bundled layouts are
  // seeded first, published (cloud) tabs arrive later, and the backend snapshot
  // can move the active workspace on its own. Bailing out on the first ready
  // pass dropped the deep link entirely (fresh profile landed on the bundled
  // overview with the wrong symbol). Waiting "until the state stops changing"
  // is unsafe: it cannot tell the app's own hydration churn from a real user
  // navigation, so it either cancels too early or overwrites the user later.
  //
  // Contract: hold the requested workspace/symbol until the named workspace
  // exists, then apply exactly once. The named tab does not gate the apply —
  // waiting for a published tab would freeze the address bar forever when the
  // slug is genuinely invalid; instead the workspace is selected immediately
  // (never a no-tab spinner) and the tab slug is resolved either now or, if it
  // registers later, through `deferredTabRef`. Abandon the request only when the
  // user actually navigates: "the user navigated" is a positive signal, not a
  // state diff. The context bumps `userNavigationSeq` only from its user-facing
  // actions, never from hydration, snapshot reconciliation, or our own apply.
  useEffect(() => {
    if (!ready || hasRestoredRef.current) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const urlDashboard = params.get(PARAM_DASHBOARD);
    const urlTab = params.get(PARAM_TAB);
    const urlSymbol = params.get(PARAM_SYMBOL);

    const resolvedDashboard = urlDashboard
      ? resolveDashboardSlug(urlDashboard, dashboardIds)
      : null;
    const dashboardReady = !urlDashboard || resolvedDashboard !== null;

    if (requestedRef.current) {
      // A request is pending. The user wins only if they actually navigated
      // since we captured the sequence — hydration churn does not bump it.
      if (userNavigationSeq !== requestedRef.current.capturedSeq) {
        requestedRef.current = null;
        hasRestoredRef.current =true;
        return;
      }
      if (!dashboardReady) return; // still pending
    } else if (!dashboardReady) {
      // First pass and the target is not ready: hold it for a later hydration.
      requestedRef.current = { dashboard: urlDashboard, tab: urlTab, symbol: urlSymbol, capturedSeq: userNavigationSeq };
      return;
    }

    requestedRef.current = null;
    hasRestoredRef.current =true;
    if (urlTab && resolvedDashboard && resolveTabId(resolvedDashboard, urlTab) === null) {
      deferredTabRef.current = { dashboardId: resolvedDashboard, slug: urlTab, capturedSeq: userNavigationSeq };
    }
    applyFromSearchRef.current(window.location.search);
  }, [ready, dashboardIds, resolveTabId, userNavigationSeq]);

  // Apply a deep-linked tab that registered after its workspace did.
  useEffect(() => {
    const deferred = deferredTabRef.current;
    if (!ready || !deferred) return;
    // The user took over: the deferred slug no longer describes what should be
    // open. (Hydration churn does not bump the sequence.)
    if (userNavigationSeq !== deferred.capturedSeq) {
      deferredTabRef.current = null;
      return;
    }
    const resolved = resolveTabId(deferred.dashboardId, deferred.slug);
    if (!resolved) return;
    deferredTabRef.current = null;
    applyTab(resolved, { programmatic:true });
  }, [ready, resolveTabId, userNavigationSeq, applyTab]);

  useEffect(() => {
    const pending = pendingSymbolRef.current;
    if (!ready || !pending || activeDashboardId !== pending.dashboardId) return;
    if (symbol.toUpperCase() === pending.symbol) {
      pendingSymbolRef.current = null;
      return;
    }
    if (!pending.applied) {
      pending.applied =true;
      applySymbol(pending.symbol);
    }
  }, [ready, activeDashboardId, symbol, applySymbol]);

  // Publish the live state into the URL. Used by the write effect below and by a
  // Back/Forward that landed on a URL we could not apply.
  const writeStateToUrl = useCallback(() => {
    if (!ready || typeof window === 'undefined') return;

    const intent = intentRef.current;
    if (intent) {
      const stateLanded = activeDashboardId === intent.dashboardId
        && (intent.tabId === null || activeTabId === intent.tabId);
      const superseded = userNavigationSeq !== intent.capturedSeq;
      // Hold only while the URL is still the one we applied *and* the user has
      // not taken over; otherwise the hold would freeze the address bar.
      if (!stateLanded && !superseded && window.location.href === intent.href) return;
      intentRef.current = null;
    }

    // A deep-linked symbol that has not landed yet describes the URL we already
    // have; publishing now would replace it with the departing ticker.
    const pending = pendingSymbolRef.current;
    if (pending && activeDashboardId === pending.dashboardId) return;

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
      //
      // #102: reusing `window.history.state` verbatim left the App Router's
      // cached `url` pointing at the previous search string, so a later router
      // action restored `?dashboard=default-fundamental&tab=overview` in the
      // address bar while React state (and the rendered widgets) stayed on the
      // workspace the user chose. Carry the router's state forward but point its
      // url at what we actually wrote, so the URL and state cannot diverge.
      const rawState: unknown = window.history.state;
      const previousState: Record<string, unknown> =
        typeof rawState === 'object' && rawState !== null ? { ...rawState } : {};
      window.history.replaceState({ ...previousState, url: next, as: next }, '', next);
    }
  }, [ready, activeDashboardId, activeTabId, symbol, userNavigationSeq]);

  // Browser back/forward.
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;
    const handlePopState = () => {
      // Back/Forward replaces whatever a held deep link asked for: drop both the
      // pending request and a deferred tab slug so neither can re-apply over the
      // entry just reached. Without clearing the deferral, a tab published after
      // the history move would be applied to the *new* workspace as a foreign
      // `SET_ACTIVE_TAB` (the slug belongs to the workspace the user left).
      requestedRef.current = null;
      deferredTabRef.current = null;
      hasRestoredRef.current =true;
      if (!applyFromSearchRef.current(window.location.search)) {
        // The entry could not be applied (unknown workspace, removed tab).
        // Publish the live state so the address bar never describes a view that
        // is not on screen.
        writeStateToUrl();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [ready, writeStateToUrl]);

  // Write current state into the URL when it changes.
  useEffect(() => {
    if (!ready || !hasRestoredRef.current) return;
    writeStateToUrl();
  }, [ready, writeStateToUrl]);
}
