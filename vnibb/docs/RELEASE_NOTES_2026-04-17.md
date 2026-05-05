# Release Notes

Date: 2026-04-17

## Summary

This release consolidates a large VNIBB product-improvement wave across fundamentals, AI, units, widget resilience, dashboard UX, quant/risk, discovery, ownership, and derivatives.

## Major Shipped Areas

### Data ownership and runtime guidance

- Appwrite remains the intended full VNIBB market-data corpus.
- Supabase/Postgres is documented as the temporary write-side bridge during quota pressure.
- VniAgent copy and docs now reflect VNIBB database-first behavior more accurately.

### Adjustment-aware analytics

- quant endpoints now accept `adjustment_mode=raw|adjusted`
- adjusted history flows into risk and quant widgets, not only charts
- main historical charts show compact corporate-action markers

### VniAgent UX

- clearer settings grouping
- runtime summary card in site settings
- recent-session archive and restore in the main sidebar
- stronger runtime/context chips in the sidebar header

### USD / FX expansion

- per-year FX controls remain in site settings
- USD/VND conversion now extends into selected quote, comparison, and market-value surfaces

### Data quality / empty-state intelligence

- shared `WidgetHealthState` model for widget meta and empty states
- first-wave rollout on breadth, relative rotation, transaction flow, and foreign trading

### Dashboard intelligence

- duplicate-widget detection
- dead-tab heuristic
- undersized-widget guidance
- tab-level recommendation banner in edit mode and for materially dead tabs

### Risk model upgrade

- benchmark-relative drawdown
- 63-day beta
- 30-day tracking error
- 30-day downside deviation
- 95% VaR / CVaR

### Discovery and fundamental pulse

- `market_sentiment`
- `listing_browser` v2
- `ttm_snapshot`
- `growth_bridge`

### Ownership and derivatives synthesis

- `ownership_rating_summary`
- `derivatives_analytics`

## System Dashboard Placements

### Fundamental dashboard

- new `Discovery` tab now uses:
  - `market_overview`
  - `top_movers`
  - `market_sentiment`
  - `market_heatmap`
  - `listing_browser`
- `Overview` now features:
  - `ttm_snapshot`
  - `growth_bridge`
- `Ownership` now features:
  - `ownership_rating_summary`

### Global Markets dashboard

- the bottom derivatives row now includes:
  - `derivatives_contracts_board`
  - `derivatives_price_history`
  - `derivatives_analytics`

## Validation Completed

The shipped work was validated incrementally with targeted tests plus repeated frontend builds.

Representative commands used during this wave:

```bash
pnpm --filter frontend build
pnpm --filter frontend test -- --runTestsByPath src/lib/units.test.ts
pnpm --filter frontend test -- --runTestsByPath src/lib/vniagentSessions.test.ts src/lib/aiSettings.test.ts
pnpm --filter frontend test -- --runTestsByPath src/components/ui/WidgetMeta.test.tsx src/components/ui/widget-states.test.tsx
pnpm --filter frontend test -- --runTestsByPath src/lib/dashboardIntelligence.test.ts
pnpm --filter frontend test -- --runTestsByPath src/lib/listingBrowserViews.test.ts src/lib/financialDiscovery.test.ts
pnpm --filter frontend test -- --runTestsByPath src/lib/ownershipAnalytics.test.ts src/lib/derivativesAnalytics.test.ts
python -m pytest apps/api/tests/test_api/quant_endpoint_test.py -v
```

## Ship Checklist

Before deployment:

- verify frontend production build locally
- review system-dashboard template changes visually after the migration refresh
- smoke-check these tabs/widgets after deployment:
  - Fundamental > Discovery
  - Fundamental > Overview
  - Fundamental > Ownership
  - Global Markets
- verify dashboard migration bumped system templates for existing local users
- verify VniAgent sidebar recent-session restore
- verify USD mode on newly covered quote/comparison/market-value widgets
- verify benchmark-risk cards in Risk Dashboard and Quant Summary

After deployment:

- load `/dashboard` once to let the system dashboard template refresh migrate local saved copies
- check browser console for unexpected production warnings
- confirm TradingView widgets still initialize after the added Global Markets derivatives row

## Notes

- No artifact generation workflow was introduced in the VniAgent phase.
- No destructive change was made to the Appwrite-primary architecture direction.
- This release intentionally favored reusable helper layers so the next iteration can expand more quickly without rewriting widget-by-widget behavior.
