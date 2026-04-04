# Widget Documentation

Last synchronized: 2026-04-04

## Summary

The widget system now reflects these completed changes:

- duplicate legacy widget aliases removed from active use
- saved dashboards migrated to canonical widget IDs
- saved layout caps migrated away so older dashboards resize correctly
- major widget-local state moved into dashboard-backed widget config
- template surfaces consolidated onto one canonical template catalog
- component modal recategorized into clearer presentation groups
- VniAgent prompt routing unified through the sidebar-owned prompt library
- `financial_snapshot` added for multi-section financial review
- `earnings_release_recap` added for quarter follow-up workflow using existing data
- financial tables switched back to chronological ascending order with default auto-scroll to the newest visible periods
- time-series financial charts now use the full capped history while staying inside widget width via tick thinning instead of widening for scroll
- last active dashboard and per-dashboard last tab now persist locally across sessions
- low-resolution shell handling now overlays VniAgent sooner to protect workspace width
- financial widgets now support USD display with local per-year FX overrides and an admin global fallback rate

## Canonical References

- `apps/web/src/data/widgetDefinitions.ts`
- `apps/web/src/components/widgets/WidgetRegistry.ts`
- `apps/web/src/lib/dashboardLayout.ts`
- `apps/web/src/contexts/DashboardContext.tsx`
- `apps/web/src/types/dashboard-templates.ts`

## Widget Library Presentation Groups

Presentation groups in the component modal are now:

- Fundamentals
- Market Pulse
- Charting
- Global Markets
- Quant & Signals
- Ownership
- News & Events
- AI & Research
- Screeners & Tools

These are UI groupings and do not require changing the stored widget category enum.

## Screener Upgrade

- Screener Pro now serializes quick filters plus advanced filter-builder state into backend `filters` JSON.
- Primary sorting is now sent to the backend via `sort`.
- Saved screens now persist in widget config and restore filters, advanced logic, sort, market, view mode, and column sets.

## Future Optimization Roadmap

- Keep current capped annual and quarterly windows until the next optimization pass; this avoids the first-load performance drop seen with larger histories.
- Planned next-step optimization work:
  - normalize 10Y history coverage across all financial fields
  - reduce per-widget payload size before expanding default history windows
  - consider virtualized or chunked financial-column rendering for very wide histories
  - evaluate a dedicated backend snapshot payload only if multi-endpoint composition becomes a bottleneck
  - continue compact-shell work for low-resolution layouts, especially header tool density and tab-bar controls
  - add deeper regression coverage for quarter-specific statement requests (`Q1`/`Q2`/`Q3`/`Q4`) and unified financial tabs
  - extend USD conversion beyond statement-style widgets into quotes and broader market widgets only after the financial-first path is stable

## Final Resize Notes

The final resize sweep loosened both outer-grid and inner-content constraints for key widgets, including:

- `transaction_flow`
- `major_shareholders`
- `officers_management`
- `volume_flow`
- `sortino_monthly`
- `drawdown_recovery`
- `macd_crossovers`
- `bollinger_squeeze`
- `rsi_seasonal`
- `gap_analysis`
- `quant_summary`
- `comparison_analysis`

Additional list and table widgets were updated to reduce aggressive truncation and make narrow layouts more usable.

## Persistence Notes

Config-backed widget state now covers:

- notes
- watchlist
- price alerts
- peer comparison
- research browser

Browser-local storage should remain reserved for device-local behavior such as notification permission hints and lightweight recent UI picks.
