# PostHog Analytics

This document describes the current PostHog product analytics setup for `apps/web`.

## Scope

- Frontend-only product analytics.
- Manual event capture for high-signal user actions.
- No PostHog session replay.
- No PostHog autocapture.
- No backend event forwarding in the current phase.

## Environment

Set these where the Next.js frontend is built and served.

```env
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_POSTHOG_KEY=phc_your_public_project_key
```

Notes:

- `NEXT_PUBLIC_*` values are embedded into the frontend build.
- Put them in Vercel if Vercel builds the app.
- Put them in OCI if OCI builds and serves the frontend.
- Do not store the real project key in repo-tracked env example files.

## Architecture

Main files:

- `apps/web/src/lib/analytics.ts`
- `apps/web/src/components/analytics/AnalyticsBootstrap.tsx`
- `apps/web/src/contexts/AuthContext.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/widgets/WidgetWrapper.tsx`
- `apps/web/src/components/ui/WidgetHeader.tsx`
- `apps/web/src/components/ui/PeriodToggle.tsx`
- `apps/web/src/hooks/useWidgetSymbolLink.ts`
- `apps/web/src/components/widgets/ScreenerWidget.tsx`

Current behavior:

- `analytics.ts` lazy-loads `posthog-js` so the base app bundle is not forced to pay the full SDK cost up front.
- `AnalyticsBootstrap.tsx` initializes analytics and emits manual `$pageview` events from the App Router.
- `AuthContext.tsx` identifies authenticated users and resets back to anonymous on logout.
- Anonymous identity is aligned with VNIBB's existing browser-local dashboard client id from `getDashboardClientId()`.

## Privacy Rules

The current implementation intentionally avoids sending sensitive content.

Never send:

- passwords
- auth form contents
- API keys
- admin layout keys
- copilot prompt text
- copilot response text
- document names or document contents
- feedback notes

Current capture strategy sends metadata only, for example:

- provider
- model
- latency
- counts for sources, artifacts, and actions
- dashboard, tab, widget, and symbol identifiers

## Event Coverage

The full event list lives in `apps/web/src/lib/analytics.ts` under `ANALYTICS_EVENTS`.

Current event families include:

- auth: login/signup start, success, failure
- navigation: pageviews, command palette open/select, mobile menu open/close, settings open
- onboarding: walkthrough start, step viewed, complete, restart request
- workspace management: workspace create, rename, duplicate, delete, move, reorder, switch, grouping toggle
- folder management: folder create, rename, delete, expand/collapse
- tab management: create, rename, delete, reorder, switch
- widget management: add, batch add, remove, clone, widget settings open/save
- shared widget chrome: refresh, maximize, collapse, export, settings, close, copy to dashboard, group change, symbol change, guide open, link toggle
- shared widget controls: period toggles, market toggles, header parameter dropdowns, multi-select widget controls
- screener workflows: saved screen open/select/save/delete, filter add/update/remove, column customizer open/reset/toggle, view mode changes, sort changes, filter reset, symbol drill-down
- templates: apps library open, template selector open, workspace template applied
- symbol flow: symbol search submitted, symbol changed
- linked-symbol drilldowns: widgets using `useWidgetSymbolLink` now emit a shared analytics event when users jump from a leaderboard, heatmap, matrix, watchlist, or peer widget into another symbol
- settings: preferences save, settings tab viewed, AI settings save/reset, vnstock source change, unit change, decimal change, USD override update/reset
- admin settings: layout key save/clear/fail, layout controls toggle, runtime AI save, USD default save, shared prompt add/remove/save
- copilot: open, prompt library open/select, prompt submit, response complete/fail, export, document attach, feedback submit, new chat
- AI widgets: standalone AI widget and AI analysis widget use the same metadata-based copilot events with widget-specific sources
- widget load telemetry: TradingView widget load success/failure metadata

## Performance Notes

Performance protections already in place:

- lazy SDK import
- manual events only
- no DOM autocapture
- no replay recording
- no large payload capture
- no per-keystroke analytics

When adding new events, keep these rules:

- emit on user intent, not on every render
- emit on commit actions, not during draft typing
- prefer ids, enums, booleans, and counts over raw text
- reuse existing event names where the semantic action is the same

## Verification

Recommended local checks:

```bash
pnpm --filter frontend exec tsc --noEmit
pnpm --filter frontend build
```

Recommended runtime checks:

1. Open PostHog Live Events.
2. Load the dashboard and confirm `$pageview` arrives.
3. Change symbol, add a widget, switch tabs, open VniAgent, and submit one prompt.
4. Confirm event payloads contain ids and metadata, but not prompt or document text.

Current repo note:

- the frontend build is currently blocked by an unrelated existing `/auth/callback` App Router `useSearchParams()` suspense issue
- this is not introduced by the analytics integration

## Future Extensions

Possible next phases:

- first-party `/ingest` proxy if ad blockers become a problem
- privacy-reviewed session replay with explicit masking/blocking rules
- feature flags via PostHog after analytics stabilizes
- backend-side business event capture for durable server workflows
