# Dashboard Performance & Correctness Overhaul

Date started: 2026-07-22
Owner: VNIBB maintainers
Status: Implementation in progress
Trigger: Live benchmark of `vnibb-web.vercel.app/dashboard` reported "unoptimization" and
widgets appearing not to work.

## How This Was Measured

Drove the live production site in a real Chromium (Playwright), swept all seven system
workspaces (Discovery, Fundamentals, Company, Ownership, Comparison, News, Global Markets),
and traced console errors, page errors, and the network waterfall on cold and warm loads.

Findings that shaped this plan:

- Backend is healthy. Every data endpoint returned `200`
  (`/health`, `/equity/*`, `/dashboard/system-layouts/published`, `/insider`, `/alerts`).
- No React error boundary tripped and no uncaught console errors fired in any workspace
  once it settled. The "many widgets not working" symptom was fallout from slow boot plus
  request-abort noise on fast tab switching, not real widget crashes.
- Cold first paint sat on a plain "Loading dashboard..." text spinner for ~18s in a fresh
  (uncached) browser. It is not CPU-bound (only ~181ms of long tasks) and not blocked on
  API calls (zero calls during that window) - it is JS download + hydration latency over a
  non-CDN origin plus a per-request SSR document.
- Warm reload (JS cached) reached interactive in <1s of hydration once TTFB returned; the
  cold penalty is dominated by document TTFB and downloading 29 JS chunks (~419KB) from an
  origin with no edge cache.
- One genuine correctness bug: `/api/v1/news/trending` returns 404 on every boot because of
  a router double-prefix (see 1.1), silently breaking `MarketSentimentWidget`.

## Scope

Bug fixes plus a performance overhaul. Two deploy targets: frontend (`apps/web`, Vercel) and
backend (`apps/api`, Oracle origin). Backend read-only response caching is in scope per
maintainer decision.

## Phases

### Phase 1 - Correctness bugs

- **1.1 `/news/trending` 404.** `news_router` is mounted twice, under `/market` and `/news`
  (`api/v1/router.py:128-138`), but six of its routes carry a redundant internal `/news/`
  prefix, so the real path becomes `/api/v1/news/news/trending`. The frontend calls
  `/api/v1/news/trending` (`lib/api.ts:1252`) and 404s. A prior workaround added a bare
  `/sentiment` alias next to `/news/sentiment` for the same reason. Fix: strip the redundant
  in-file `/news/` prefixes so the mount prefix is the single source of truth, keeping the
  `/market/*` mount working too. Guard with a smoke test asserting `/news/trending` and
  `/news/sentiment` resolve and the double-prefixed paths do not.
- **1.2 Request-abort noise.** Fast tab switching cancels in-flight queries, surfacing
  `ERR_ABORTED` as console noise that reads like breakage. Ensure aborted/cancelled reads do
  not present as widget errors.

### Phase 2 - Perceived load

- **2.1 Collapse double loading states.** Server skeleton -> bare "Loading dashboard..." text
  -> UI. Replace the plain-text hydration gate in `DashboardClient.tsx` with a skeleton that
  matches the shell so loading feels continuous instead of broken.
- **2.2 De-gate shell first paint.** The whole dashboard hides behind a single `mounted`
  flag. Render the static shell chrome immediately and gate only the grid/widgets.

### Phase 3 - Cold-load performance

- **3.1 Edge-cache the document (flagged, not auto-shipped).** `/dashboard` SSRs per request
  with no edge cache. Highest-risk change; documented as a proposal for separate approval.
- **3.2 Reduce cold JS.** Dynamically import interaction-only surfaces (modals, AI copilot,
  onboarding walkthrough) out of the initial `DashboardClient` chunk.

### Phase 4 - Backend caching

- **4.1 `Cache-Control` on read-only endpoints.** Add `s-maxage`/`stale-while-revalidate` to
  genuinely non-personalized reads (`/health`, published system layouts) so repeat visitors
  and edge caches avoid the cold origin round-trip. Per-symbol/market endpoints get short
  TTLs only where freshness contracts allow.

## Verification

- `pnpm --filter frontend lint`, `tsc --noEmit`, focused Jest.
- `python -m ruff check` on touched backend files, focused pytest for the router smoke test.
- Full `pnpm run ci:gate` before commit.

## Progress Log

- 2026-07-22: Live benchmark completed; findings above recorded. Plan approved
  (fixes + perf overhaul, include backend caching). Implementation started.
