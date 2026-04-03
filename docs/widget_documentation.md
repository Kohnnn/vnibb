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
