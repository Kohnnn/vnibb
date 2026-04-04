# TradingView Global Markets Implementation Plan

Date: 2026-04-04

## Goal

Separate TradingView/global-market symbol sync from the VNIBB stock symbol flow while keeping TradingView widgets linked to each other across dashboards.

## Required behavior

- VNIBB stock widgets keep using the existing app-wide stock symbol.
- TradingView/global-market widgets use a different shared symbol channel.
- The TradingView/global-market symbol syncs across dashboards.
- Only TradingView/global-market widget interactions can change that symbol.
- Changing a VNIBB stock symbol must not affect TradingView widgets.
- The default TradingView/global-market symbol is `NASDAQ:VFS`.

## Scope

### 1. Symbol scope split

Introduce a dedicated persisted symbol store for TradingView/global-market widgets.

- Existing store: VNIBB stock symbol for local market widgets.
- New store: TradingView/global-market symbol for native TradingView widgets.

This keeps symbols like `NASDAQ:VFS`, `FX:USDVND`, or `BINANCE:BTCUSDT` out of the VNIBB stock-only ticker flow.

### 2. Dashboard shell routing

Update the dashboard shell so symbol-bearing TradingView widgets resolve their active symbol from the new TradingView/global-market symbol store when `useLinkedSymbol !== false`.

Non-TradingView widgets keep using the existing stock symbol path.

### 3. Widget-side updates

Update TradingView widget interactions so symbol changes only write to the TradingView/global-market symbol store.

Expected write paths:

- TradingView widget settings modal save
- TradingView widget toolbar ticker changes when enabled later

### 4. Defaults

Set the default TradingView/global-market symbol to `NASDAQ:VFS` and keep the Global Markets starter layouts aligned with that default.

### 5. Web Component fixes

Fix TradingView Web Component runtime issues found during verification.

Immediate fixes:

- use the correct widget loader host for Web Components
- align defaults with current TradingView Web Component settings where app metadata drifted from docs/runtime

Priority widgets:

- Ticker Tape
- Ticker Tag
- Mini Chart
- Market Summary
- Economic Map

### 6. Layout and UX follow-up

Review overflow and sizing behavior for popover-driven widgets like `Ticker Tag` so hover content is not clipped by dashboard card containers.

### 7. Admin-managed widget settings

Global Markets widget settings should continue to flow through the existing admin-managed system dashboard publish path instead of a separate TradingView-only settings backend.

- Widget settings are edited through `WidgetSettingsModal`.
- System-dashboard admin mode controls whether Global Markets widget settings are editable or read-only.
- `Save Draft` and `Publish Global` remain the only publishing actions.
- The shared Global Markets symbol is persisted on the Global Markets dashboard payload so publishing captures both widget config and linked TradingView symbol state.

## Verification

- `pnpm --filter frontend build`
- Manual checks:
  - Change VNIBB stock symbol and confirm TradingView/global-market widgets do not change.
  - Change a linked TradingView widget symbol and confirm other linked TradingView widgets update.
  - Confirm the shared TradingView/global-market symbol persists across dashboards.
  - Confirm `NASDAQ:VFS` is the default linked symbol for Global Markets.
  - Confirm the previously failing Web Component widgets render.
