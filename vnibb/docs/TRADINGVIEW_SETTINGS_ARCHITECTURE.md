# TradingView Settings Architecture

Date: 2026-04-17

## Scope

- This document covers the TradingView native widget settings modal in `apps/web/src/components/modals/WidgetSettingsModal.tsx`.
- TradingView widget metadata, default configs, docs URLs, and typed field definitions live in `apps/web/src/lib/tradingViewWidgets.ts`.

## Editing Model

- TradingView widgets use a hand-curated typed settings surface.
- The typed controls are not generated from TradingView documentation at runtime.
- Advanced JSON remains available for nested payloads and doc-level edge cases that are not modeled as first-class controls.

## System Dashboard Rules

- System dashboards are admin-only editable.
- The widget settings modal is read-only on system dashboards until Admin Mode is enabled.
- Saving in the modal updates the current draft only.
- Admins must still use the floating system dashboard controls to `Save Draft` or `Publish Global`.

## Runtime Transforms

Several modal values are convenience fields rather than final TradingView payload keys:

- `useLinkedSymbol` controls symbol routing in the app, then is removed from the emitted TradingView payload.
- `tabsPreset` expands into `tabs` for Market Overview.
- `symbolsGroupsPreset` expands into `symbolsGroups` for Market Data.
- `panelPreset` seeds `fieldGroups` / `columns` for Fundamental Data.

Because of these transforms, the modal now exposes a runtime payload preview so admins can verify the final config that reaches TradingView.

## Linked Symbol Behavior

- For symbol-linked TradingView widgets, the shared Global Markets symbol can override the widget-local symbol at runtime.
- The modal now makes this visible and treats the symbol field as linked until `Link Symbol` is disabled.

## When To Use Advanced JSON

Advanced JSON should be used for nested TradingView payloads such as:

- `tabs` for fully custom Market Overview tab groups
- `symbolsGroups` for custom Market Data grouped quote tables
- `symbols` for rich Symbol Overview payloads
- complex `studies`, `compareSymbols`, and other advanced chart payloads

## Key Touchpoints

- `apps/web/src/lib/tradingViewWidgets.ts`
- `apps/web/src/components/modals/WidgetSettingsModal.tsx`
- `apps/web/src/components/widgets/TradingViewNativeWidgets.tsx`
