# VNIBB Evaluation Remediation Progress - 2026-05-28

Source: `../docs/evaluationreprot.md` (QA Evaluation Report v1.4.0, 2026-05-28).

## Scope

Fix every open item in the v1.4.0 evaluation report, with detail tracked as changes land.

## Bug Registry

| ID | Priority | Area | Status | Target |
|---|---:|---|---|---|
| TMPL-1 | P0 | Templates | Patched | `Use Template` creates/applies an editable workspace with visible feedback. |
| TMPL-2 | P0 | Templates | Patched | `Save Current` opens a clear save flow, persists layout, and shows saved layouts. |
| T-1 | P0 | Order Book | Patched | Closed-market order book shows last usable prices, not `--`/`00`. |
| CRYPTO-1 | P1 | Global Markets | Patched | Crypto sub-tab chart stays on `BINANCE:BTCUSDT` even for old stored layouts. |
| NE-1 | P1 | News | Patched | VNEXPRESS dates parse across market-news and world-news paths. |
| OWN-1 | P2 | Foreign Trading | Patched | Cache-age label uses trading-day/ICT semantics instead of midnight age. |
| F-Q-1 | P2 | Fundamentals | Patched | Quarterly ratios render data or an explicit data-unavailable state. |

## Implementation Plan

1. Reconcile report symptoms with current code and prior remediation docs.
2. Patch low-risk frontend state/catalog issues first: Templates and Crypto default migration.
3. Patch backend data reliability: Order Book fallback, VNEXPRESS parser, Foreign Trading metadata semantics.
4. Patch ratios rendering/filtering only after confirming the affected widget path.
5. Add targeted tests for new behavior where practical.
6. Run focused verification, then update this progress log with exact commands and outcomes.

## Progress Log

### 2026-05-28 - Triage

- Confirmed active app repo is `vnibb/`; root `docs/evaluationreprot.md` is outside the active app docs tree.
- Confirmed prior fixes exist for many symptoms in `docs/DASHBOARD_REMEDIATION_PROGRESS_2026-05-24.md`; remaining failures are likely stale persisted state, stale template catalog defaults, closed-market fallback gaps, and parser duplication.
- Found concrete stale reusable-template issue: `apps/web/src/types/dashboard-templates.ts` still seeds the Global Markets template with `NASDAQ:VFS` instead of the current system-dashboard `AMEX:SPY` configuration.
- Found persisted Crypto-state gap: `shouldRefreshGlobalMarketsLayout()` only detects `SP:SPX` and missing WorldNews widgets. It does not detect old Crypto sub-tabs inheriting `AMEX:SPY`, missing `useLinkedSymbol: false`, or missing `allow_symbol_change: false`.

### 2026-05-28 - Current Changes

- `apps/web/src/types/dashboard-templates.ts`: updated the reusable `Global Markets` template card to seed `AMEX:SPY` and opt out of linked-symbol mutation, matching the system Global Markets dashboard. This removes stale `NASDAQ:VFS` from `Use Template` output.
- `apps/web/src/components/modals/TemplateSelector.tsx`: made save/import success visible after the inline save flow closes, while keeping validation/import failures as red error messages. This addresses the silent-close perception in `SAVE CURRENT`.
- `apps/web/src/contexts/DashboardContext.tsx`: expanded `shouldRefreshGlobalMarketsLayout()` to refresh old stored Global Markets dashboards when TradingView widgets still use legacy symbols, linked-symbol defaults, or a misconfigured Crypto chart. This heals old `localStorage` snapshots without asking users to clear browser data.
- `apps/api/vnibb/api/v1/equity.py`: added `_orderbook_payload_has_prices()` and now reject warm/live orderbook payloads that contain only volume with null/zero prices. Those responses fall back to the latest DB snapshot and are tagged `is_stale: true`, `market_status: closed`.
- `apps/api/vnibb/api/v1/equity.py`: added a second-order Order Book fallback for the deployed no-priced-snapshot case. If live depth and DB snapshots both lack prices, the endpoint now uses the latest close/screener price as a marked `reference` price instead of returning `PRICE "--"` / `LAST 00`.
- `apps/web/src/components/widgets/OrderbookWidget.tsx`: fixed `last_price` handling so `null` no longer becomes `0` via `Number(null)`. The header now shows `10 levels` unless a positive last price exists.
- `apps/api/tests/test_api/test_smoke_endpoints.py`: added regression coverage for live volume-only orderbook fallback to a priced stale DB snapshot.
- `apps/api/tests/test_api/test_smoke_endpoints.py`: added regression coverage for live volume-only orderbook fallback to latest close when no priced orderbook snapshot exists.
- `apps/api/vnibb/services/news_crawler.py`: extended date layouts to parse Vietnamese numeric dates with explicit timezone offsets after `GMT+7` normalization.
- `apps/api/vnibb/services/world_news_service.py`: added the same `GMT+7`, Vietnamese weekday, and timezone-aware numeric layout handling to the separate world-news RSS parser.
- `apps/api/tests/test_api/test_news_service.py`: added coverage for `_coerce_published_date("Thứ 5, 28/05/2026 17:00:00 GMT+7")`.
- `apps/api/tests/test_api/test_world_news_service.py`: added coverage for a VNEXPRESS-style RSS item date resolving to UTC.
- `apps/api/vnibb/api/v1/equity.py`: live `/foreign-trading` responses now include `meta.symbol` and `meta.last_data_date` from the latest row, matching fallback responses.
- `apps/web/src/components/widgets/ForeignTradingWidget.tsx`: date-only foreign-trading freshness now resolves to 17:00 ICT settlement time instead of midnight, so today's 17:00 snapshot at 19:00 ICT reads as about 2h old, not 12h old.
- `apps/web/src/components/widgets/ForeignTradingWidget.test.tsx`: added regression coverage for date-only and explicit timestamp parsing.
- `apps/api/tests/test_api/test_smoke_endpoints.py`: extended the foreign-trading smoke test to assert live `last_data_date` metadata.
- `apps/web/src/components/widgets/FinancialRatiosWidget.tsx`: switched period normalization to the shared `normalizeFinancialPeriod()` helper and added ratio field aliases (`pe_ratio`, `pb_ratio`, `ps_ratio`, provider camel-case forms) when deciding whether quarterly rows have renderable metrics.
- `apps/web/src/components/widgets/FinancialsWidget.tsx`: added an all-quarter `Q` option, fixed ratio TTM mode so backend `TTM` rows are not treated as quarterly rows, and added ratio aliases for unified financial table rendering.

### 2026-05-28 - Verification

- `pnpm --filter frontend test -- --runTestsByPath src/components/widgets/ForeignTradingWidget.test.tsx src/lib/financialPeriods.test.ts src/lib/newsTime.test.ts --runInBand`: passed, 3 suites / 8 tests. Warning only: expected missing local env vars fallback in Jest.
- `python -m pytest apps/api/tests/test_api/test_world_news_service.py apps/api/tests/test_api/test_news_service.py apps/api/tests/test_api/test_smoke_endpoints.py -v -k "vnexpress or orderbook or foreign_trading"`: passed, 5 selected / 79 deselected.
- `pnpm --filter frontend exec tsc --noEmit`: passed.
- `pnpm --filter frontend lint`: passed.
- `python -m py_compile apps/api/vnibb/api/v1/equity.py apps/api/vnibb/services/news_crawler.py apps/api/vnibb/services/world_news_service.py`: passed.
- `pnpm run ci:gate`: passed end-to-end. Frontend lint/build/tests passed (8 suites / 21 tests). Backend compile/tests passed (255 tests).
- Follow-up: `python -m pytest apps/api/tests/test_api/test_smoke_endpoints.py -v -k "orderbook"`: passed, 3 selected / 67 deselected.
- Follow-up: `python -m py_compile apps/api/vnibb/api/v1/equity.py`: passed.

### 2026-05-28 - Deployment And Public Smoke

- Committed and pushed full remediation as `f4378db fix(dashboard): remediate v1.4 evaluation regressions`.
- Deployed `f4378db` to OCI `/srv/vnibb`; containers `vnibb-api`, `vnibb-mcp`, and `vnibb-caddy` were healthy and `alembic upgrade head` completed.
- Public smoke after `f4378db` passed for `/live`, `/ready`, `/foreign-trading?limit=3`, and `/ratios?period=quarter`, but exposed the production-only Order Book gap where live depth had volumes and no prices and no priced DB snapshot was available.
- Committed and pushed the Order Book follow-up as `a7a4d5a fix(orderbook): fallback to latest price when depth lacks prices`.
- Deployed `a7a4d5a` to OCI; `alembic upgrade head` completed and `docker compose ps` showed `vnibb-api` healthy, `vnibb-mcp` healthy, and `vnibb-caddy` running.
- Public `/live`: returned `{"alive":true}`.
- Public `/ready`: returned `{"ready":true}`.
- Public `/api/v1/equity/VCI/orderbook`: returned `last_price: 25.0`, ten entries with `price: 25.0`, `price_status: "reference"`, `price_source: "latest_price"`, `is_stale: true`, and `market_status: "closed"`. This confirms T-1 no longer renders `LAST 00` / all `--` in the deployed closed-market no-snapshot case.
- Public `/api/v1/equity/VCI/foreign-trading?limit=3`: returned fallback rows through `2026-05-28` with `meta.symbol: "VCI"` and `meta.last_data_date: "2026-05-28"`.
- Public `/api/v1/equity/VCI/ratios?period=quarter`: returned 64 rows with `meta.full_ratio_coverage_starts: "Q1-2024"` and latest `Q1-2026` ratio data.

## Final Status

All seven open evaluation report items are patched, covered by focused regression tests where appropriate, committed, pushed, deployed to OCI, and publicly smoke-tested. Full CI gate is green.
