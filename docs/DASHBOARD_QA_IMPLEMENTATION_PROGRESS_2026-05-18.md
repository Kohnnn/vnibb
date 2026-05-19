# Dashboard QA Implementation Progress - 2026-05-18

This document tracks the local implementation plan and progress for the VNIBB dashboard QA remediation pass started on 2026-05-18.

## Scope

- Fix fatal chart mount/dimension failures before lower-priority UI polish.
- Fix `GET /api/v1/insider/block-trades` legacy-schema failures and avoid user-visible 500s.
- Fix blank/ghost chart and peer-comparison states caused by sizing and response-shape mismatches.
- Fix Similar Stocks P/E placeholder `0.0` display.
- Clean up remaining shell/template/news/a11y/security issues that can be fixed without broad redesign.

## Implementation Plan

1. Harden `TradingViewAdvancedChart.tsx` so lightweight-charts only receives finite positive dimensions, retry loops are bounded/cleaned up, and resize crashes are non-fatal.
2. Replace percentage-height Recharts mounting in Fibonacci and Ichimoku widgets with `ChartSizeBox` explicit dimensions and finite numeric data filters.
3. Add backend block-trades fallback reads for legacy `block_trades` schemas missing modern columns such as `side`, `volume_ratio`, `is_foreign`, or `is_proprietary`.
4. Make block-trades frontend state tolerate `side: null` and show a specific unavailable error state.
5. Normalize peer-comparison responses from both supported backend shapes and align radar metric keys with current API metric IDs.
6. Treat P/E `0` values as missing placeholders when building/displaying similar-stock peers.
7. Finish low-risk third-batch polish: distinguish native vs TradingView screeners, add account menu and index loading skeletons, surface RSS failures, and add baseline dialog ARIA labels.
8. Finish low-risk AI/news/polling/security polish: sync VniAgent runtime display, warn on browser-local keys, move fixed polling intervals to adaptive foreground-only presets, and gate temporary auth bypass behind an explicit env flag.

## Progress Log

- 2026-05-18: Read-only discovery completed for chart, block-trades, and peer data flows.
- 2026-05-18: Implementation started. Initial patch targets are chart mount hardening, block-trades schema fallback, and peer/similar-stock normalization.
- 2026-05-18: Implemented lightweight chart dimension hardening in `TradingViewAdvancedChart.tsx`.
- 2026-05-18: Reworked Fibonacci and Ichimoku chart rendering to use explicit `ChartSizeBox` dimensions and finite numeric data.
- 2026-05-18: Implemented block-trades legacy-schema fallback in `InsiderTrackingService.get_recent_block_trades()` and made the endpoint return a safe empty list if validation/query handling still fails.
- 2026-05-18: Updated the block-trades widget to use the shared query hook, include `limit` in the query key, and render null trade side as neutral/unknown.
- 2026-05-18: Fixed Similar Stocks P/E placeholder handling by treating non-positive P/E values as missing and allowing valid snapshot P/E to backfill cached `0` values.
- 2026-05-18: Normalized peer-comparison data from both `{ metrics, stocks, period }` and `{ symbols, metrics, data, priceHistory }` shapes, aligned radar metric keys with API metric IDs, and prevented metrics-only responses from rendering an empty table body.
- 2026-05-18: Added backend regression tests for block-trades legacy-schema fallback and peer P/E snapshot backfill.
- 2026-05-18: Added native TradingView script/module and iframe timeouts so blocked third-party widgets fail visibly instead of spinning forever.
- 2026-05-18: Re-enabled light/dark theme persistence and surfaced theme controls in the header display menu and Settings appearance tab.
- 2026-05-18: Fixed the market-status chip so `HOSE Closed` no longer inherits a green backend-health style.
- 2026-05-18: Updated tab and command-palette shortcut labels to show `Ctrl` or `Cmd`/`⌘` based on platform while keeping both keyboard modifiers supported.
- 2026-05-18: Seeded default yearly USD/VND rates in frontend unit formatting and backend unit runtime config defaults.
- 2026-05-18: Sanitized VniAgent messages, persisted chat history, API history payloads, and exports to strip leaked leading system/runtime JSON such as `{ "MODEL": "..." }`.
- 2026-05-18: Added OpenRouter model-catalog timeout handling and visible Settings feedback while preserving manual model entry.
- 2026-05-18: Audited `ownership_rating_summary`; it is already present in `WidgetRegistry`, `WidgetType`, widget definitions, previews, names, and descriptions, so no ghost-widget removal was needed.
- 2026-05-18: Clarified screener labeling so `screener` is `VNIBB Screener Pro` and `tradingview_screener` is `TradingView Screener`.
- 2026-05-18: Added header index-chip skeletons while market overview data is loading and replaced the static avatar icon with an account dropdown showing session/provider/role plus Settings and sign-in/sign-out actions.
- 2026-05-18: Added world-news failed-feed detail models with failure reason and timestamp, included them in feed/map API responses and map buckets, and updated regression tests.
- 2026-05-18: Added inline Custom RSS success/clear/failure feedback in the World News Monitor and Map widgets.
- 2026-05-18: Surfaced failed RSS details in World News Monitor, Map, and Sources widgets; Sources now runs a lightweight source-health query and marks failed feed chips.
- 2026-05-18: Added baseline `role="dialog"`, `aria-modal="true"`, labelled titles, and button types to Template Selector, Widget Settings, and Manage Tabs modals.
- 2026-05-18: Added dedicated dividend-yield normalization/formatting so ratio, percent, and provider-scaled values such as `388` display as `3.88%`, while impossible yields are suppressed.
- 2026-05-18: Added profile metadata fallbacks for `established_date`/`listing_date` aliases and optional employee-count aliases from provider/Appwrite raw payloads.
- 2026-05-18: Added foreign-trading DB fallback when the live VCI feed times out, errors, or returns no rows; the widget now surfaces cached-fallback health details and the query key includes `limit`.
- 2026-05-18: Improved correlation and relative-rotation empty states with overlap/coverage guidance; relative rotation now accepts shorter validated overlap when a full 260-day window is unavailable.
- 2026-05-18: Synced Settings' VniAgent app-default runtime summary with the public runtime provider/model and updated it immediately after admin runtime saves.
- 2026-05-18: Added explicit Browser Key warnings in Settings and the VniAgent sidebar explaining localStorage/browser-profile credential risk.
- 2026-05-18: Added adaptive polling presets for market overview, price board, news, slow news, and research feeds; replaced fixed query refetch intervals with foreground-only adaptive intervals across market/news widgets and shared query hooks.
- 2026-05-18: Kept `ProtectedRoute` aligned with the current local workspace/admin-key rollout: dashboard login enforcement is disabled by default and only enabled when `NEXT_PUBLIC_ENABLE_AUTH=true`.
- 2026-05-18: Added reusable dialog focus trapping and Escape-key close handling via `useDialogFocusTrap`, then applied it to Settings, Template Selector, Widget Settings, and Manage Tabs dialogs.
- 2026-05-18: Added non-color movement cues to the highest-visibility price/flow indicators: header quote/index chips now say Up/Down/Flat, Ticker Info daily change includes direction text, and Foreign Flow / Block Trades net and side labels no longer depend on color alone.
- 2026-05-18: Documented that tenant login/RBAC is a later roadmap phase; current frontend deployments should leave `NEXT_PUBLIC_ENABLE_AUTH` unset or `false`.
- 2026-05-18: Isolated backend pytest from local developer/production env for admin auth, Appwrite, MongoDB, and MCP settings; adjusted affected sync tests to opt into fake Appwrite writes and mock daily profile/financial stages explicitly.
- 2026-05-18: Full `pnpm run ci:gate` now passes after frontend lint/build/Jest, backend compile, and the full backend pytest suite.

## Validation Log

- Passed: `pnpm --filter frontend exec tsc --noEmit`.
- Passed: `pnpm --filter frontend lint`.
- Passed: `pnpm --filter frontend test -- --runInBand`.
- Passed: `python -m py_compile apps/api/vnibb/services/insider_tracking.py apps/api/vnibb/api/v1/insider.py apps/api/vnibb/services/comparison_service.py apps/api/tests/test_api/test_insider_tracking_service.py apps/api/tests/test_api/test_comparison_service.py`.
- Passed: `python -m pytest apps/api/tests/test_api/test_insider_tracking_service.py apps/api/tests/test_api/test_comparison_service.py -v`.
- Passed: `python -m pytest apps/api/tests/test_api/quant_endpoint_test.py -v -k legacy_block_trade_schema`.
- Passed with Windows line-ending warnings only: `git diff --check`.
- Passed: `python -m py_compile apps/api/vnibb/services/unit_runtime_config_service.py`.
- Failed as expected without production env: `pnpm --filter frontend build` stopped at prerender because `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` were unset.
- Passed with explicit local env values: `$env:NEXT_PUBLIC_API_URL='http://localhost:8000'; $env:NEXT_PUBLIC_WS_URL='ws://localhost:8000/api/v1/ws/prices'; pnpm --filter frontend build`.
- Not clean: `python -m ruff check apps/api/vnibb/services/insider_tracking.py apps/api/vnibb/api/v1/insider.py apps/api/vnibb/services/comparison_service.py` reports broad pre-existing style issues in legacy backend files; this pass did not bulk-format those files to avoid unrelated churn.
- Passed: `python -m py_compile apps/api/vnibb/services/world_news_service.py apps/api/vnibb/api/v1/news.py apps/api/tests/test_api/test_world_news_service.py`.
- Passed: `python -m pytest apps/api/tests/test_api/test_world_news_service.py -v`.
- Passed: `pnpm --filter frontend test -- --runTestsByPath src/components/widgets/WorldNewsMonitorWidget.test.tsx --runInBand` with the existing missing-env warning and local default fallback.
- Re-ran and passed: `pnpm --filter frontend exec tsc --noEmit`.
- Re-ran and passed: `pnpm --filter frontend lint`.
- Re-ran and passed with Windows line-ending warnings only: `git diff --check`.
- Passed: `python -m py_compile apps/api/vnibb/api/v1/equity.py apps/api/vnibb/api/v1/quant.py apps/api/vnibb/providers/vnstock/equity_profile.py apps/api/vnibb/providers/vnstock/foreign_trading.py`.
- Passed: `pnpm --filter frontend test -- --runTestsByPath src/lib/formatters.test.ts --runInBand`.
- Re-ran and passed after data-correctness changes: `pnpm --filter frontend exec tsc --noEmit`.
- Re-ran and passed after data-correctness changes: `pnpm --filter frontend lint`.
- Re-ran and passed after data-correctness changes with Windows line-ending warnings only: `git diff --check`.
- Re-ran and passed after AI/polling/auth changes: `pnpm --filter frontend exec tsc --noEmit`.
- Re-ran and passed after AI/polling/auth changes: `pnpm --filter frontend lint`.
- Re-ran and passed after AI/polling/auth changes with Windows line-ending warnings only: `git diff --check`.
- Re-ran and passed after AI/polling/auth changes with explicit local env values: `$env:NEXT_PUBLIC_API_URL='http://localhost:8000'; $env:NEXT_PUBLIC_WS_URL='ws://localhost:8000/api/v1/ws/prices'; pnpm --filter frontend build`.
- Re-ran and passed after modal focus-trap changes: `pnpm --filter frontend exec tsc --noEmit`.
- Re-ran and passed after modal focus-trap changes: `pnpm --filter frontend lint`.
- Re-ran and passed after modal focus-trap changes with Windows line-ending warnings only: `git diff --check`.
- Re-ran and passed after modal focus-trap changes with explicit local env values: `$env:NEXT_PUBLIC_API_URL='http://localhost:8000'; $env:NEXT_PUBLIC_WS_URL='ws://localhost:8000/api/v1/ws/prices'; pnpm --filter frontend build`.
- Re-ran and passed after movement-label changes: `pnpm --filter frontend exec tsc --noEmit`.
- Re-ran and passed after movement-label changes: `pnpm --filter frontend lint`.
- Re-ran and passed after movement-label changes with Windows line-ending warnings only: `git diff --check`.
- Re-ran and passed after movement-label changes with explicit local env values: `$env:NEXT_PUBLIC_API_URL='http://localhost:8000'; $env:NEXT_PUBLIC_WS_URL='ws://localhost:8000/api/v1/ws/prices'; pnpm --filter frontend build`.
- Passed after auth rollout docs changes with Windows line-ending warnings only: `git diff --check`.
- Passed: `python -m py_compile apps/api/tests/test_api/test_data_pipeline_price_sync.py apps/api/tests/test_api/test_full_market_sync.py`.
- Passed: `python -m pytest apps/api/tests/test_api/test_data_pipeline_price_sync.py::test_appwrite_price_service_syncs_provider_rows apps/api/tests/test_api/test_full_market_sync.py::test_run_daily_market_sync_uses_gap_fill_window -v`.
- Passed with explicit local frontend env values: `$env:NEXT_PUBLIC_API_URL='http://localhost:8000'; $env:NEXT_PUBLIC_WS_URL='ws://localhost:8000/api/v1/ws/prices'; pnpm run ci:gate`.
- Re-ran and passed with Windows line-ending warnings only: `git diff --check`.
- Deferred live-service validation: `python apps/api/scripts/widget_health_matrix.py --repeats 1 --timeout 2 --fail-on-error` timed out against `http://localhost:8000`, so `pnpm run gate:no502` and `pnpm run gate:widgets:strict` were not run because the local API was not reachable.

## Deferred Backlog

- Remaining AI/news follow-ups: live browser verification for runtime model labels and polling behavior under hidden/offline tabs.
- Accessibility/security follow-ups: broaden non-color movement indicators across lower-traffic quant/table widgets, production auth rollout configuration, and future server-verified admin-key flow.
