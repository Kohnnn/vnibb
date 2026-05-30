# VNIBB Evaluation Remediation Progress - 2026-05-28

Source: `../docs/evaluationreprot.md` (QA Evaluation Report v1.4.0, 2026-05-28).

## Scope

Final handoff for all open items in the v1.4.0 evaluation report. This document is the remediation record for what was fixed, how it was verified, and what production caveats remain.

## Handoff Summary

- Final status: all seven evaluation report items are `Public PASS`.
- Final shipped commits: `686f143 fix(dashboard): harden evaluation remediation follow-ups`, `97fed7f fix(news): normalize vnexpress publish dates for storage`, and `02bea23 docs(evaluation): record final remediation QA`.
- Backend runtime deployed on OCI: `97fed7f`; `/srv/vnibb` was later fast-forwarded through docs-only commits without a container rebuild.
- Final public verification window: `2026-05-29 01:19:00` to `2026-05-29 01:26:19` ICT (`+07:00`).
- Order Book caveat: the closed-market no-priced-snapshot path uses latest close as marked reference pricing (`price_status: "reference"`, `price_source: "latest_price"`), not true level-by-level bid/ask depth.
- Evidence artifacts are committed under `output/playwright/`, including the production failure capture and the final pass screenshots.

## Bug Registry

| ID | Priority | Area | Status | Target |
|---|---:|---|---|---|
| TMPL-1 | P0 | Templates | Public PASS | `Use Template` creates/applies an editable workspace with visible feedback. |
| TMPL-2 | P0 | Templates | Public PASS | `Save Current` opens a clear save flow, persists layout, and shows saved layouts. |
| T-1 | P0 | Order Book | Public PASS | Closed-market order book shows last usable prices, not `--`/`00`. |
| CRYPTO-1 | P1 | Global Markets | Public PASS | Crypto sub-tab chart stays on `BINANCE:BTCUSDT` even for old stored layouts. |
| NE-1 | P1 | News | Public PASS | VNEXPRESS dates parse across market-news and world-news paths. |
| OWN-1 | P2 | Foreign Trading | Public PASS | Cache-age label uses trading-day/ICT semantics instead of midnight age. |
| F-Q-1 | P2 | Fundamentals | Public PASS | Quarterly ratios render data or an explicit data-unavailable state. |

## Remediation Approach

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

### 2026-05-28 - Initial Remediation Changes

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

### 2026-05-29 - Production Recheck And Follow-up Patches

Recheck window: `2026-05-29 00:19:24` to `2026-05-29 00:43:01` ICT (`+07:00`).

- Public `/live`: returned `{"alive":true}`.
- Public `/ready`: returned `{"ready":true}`.
- Public `/api/v1/equity/VCI/orderbook`: returned `symbol: "VCI"`, ten rows, every row `price: 25.0`, `price_status: "reference"`, `price_source: "latest_price"`, `last_price: 25.0`, `is_stale: true`, and `market_status: "closed"`. This remains acceptable for the closed-market no-priced-snapshot case, but is reference latest-close pricing rather than true level-by-level bid/ask pricing.
- Public `/api/v1/equity/VCI/foreign-trading?limit=3`: returned rows dated `2026-05-28`, `2026-05-27`, and `2026-05-26`; `meta.symbol: "VCI"` and `meta.last_data_date: "2026-05-28"`.
- Public `/api/v1/equity/VCI/ratios?period=quarter`: returned 64 rows; latest row was `Q1-2026`; `meta.full_ratio_coverage_starts: "Q1-2024"`.
- Dashboard Order Book (`https://vnibb-web.vercel.app/dashboard`, Technical / Trading): PASS. The widget displayed `Last 25` and priced rows (`25`) with the cached/market-closed reference label; it did not display `LAST 00` or an all-`--` price column.
- Dashboard Foreign Trading (Ownership): PASS. The widget displayed `Updated 2026-05-28 07:00` and `Cached snapshot · 7h old`; it no longer used the misleading midnight-based `12h old` calculation for the `2026-05-28` data date.
- Dashboard Financial Ratios (Fundamentals, quarterly mode): PASS. The Q view rendered populated quarterly ratio data through `Q1 2026` with the `Full ratio coverage starts Q1-2024` note, not a blank header-only grid.
- Dashboard Template Library: production still had a modal layering regression where the backdrop intercepted `Use Template` clicks. Follow-up patch: give the backdrop `z-0`, give the dialog `relative z-10`, and add modal regression coverage in `TemplateSelector.test.tsx`.
- Dashboard Global Markets / Crypto: production still allowed stale `NASDAQ:VFS` persisted state to drive the Global Markets workspace. Follow-up patch: reject legacy global market symbols (`NASDAQ:VFS`, `SP:SPX`), refresh stale Global Markets dashboards/templates, reset stored stale values to `AMEX:SPY`, and preserve the Crypto chart as `BINANCE:BTCUSDT`. Local browser verification after the patch reset a forced `NASDAQ:VFS` value to `AMEX:SPY` and kept the Crypto tab on Bitcoin/TetherUS via Binance.
- Dashboard News / World News: production still showed VNEXPRESS rows as `Date unavailable`. Evidence screenshot: `output/playwright/vnibb-market-news-date-unavailable-2026-05-29.png`. Raw production API evidence: `/api/v1/news/feed?limit=5&mode=related&symbol=VCI` returned VNEXPRESS rows with `published_date: null`, while `/api/v1/news/world?source=vnexpress_business&limit=5` returned VNEXPRESS timestamps such as `28/05/2026 5:05:00 pm`. Follow-up patch: parse DMY timestamps with AM/PM in the frontend, extract VNEXPRESS article dates from article HTML metadata/dataLayer, supplement premium VNEXPRESS crawls with RSS, and update existing rows only when `published_date` is currently null and the new crawl supplies a date.
- Focused follow-up tests passed: `pnpm --filter frontend test -- --runTestsByPath src/lib/newsTime.test.ts src/components/modals/TemplateSelector.test.tsx src/lib/globalMarketsSymbol.test.ts --runInBand`.
- Focused follow-up tests passed: `python -m pytest apps/api/tests/test_api/test_news_service.py -v -k "vnexpress"`.
- Compile check passed: `python -m py_compile apps/api/vnibb/services/news_crawler.py`.
- Live extractor check passed for `https://vnexpress.net/dien-may-xanh-muon-huy-dong-hon-14-000-ty-dong-qua-ipo-5077011.html`, resolving `2026-05-22T10:24:00+00:00`.

### 2026-05-29 - Follow-up Deployment And Final Public QA

Final verification window: `2026-05-29 01:19:00` to `2026-05-29 01:26:19` ICT (`+07:00`).

- Committed and pushed frontend/backend follow-ups as `686f143 fix(dashboard): harden evaluation remediation follow-ups`.
- During production VNEXPRESS crawl verification, found one more backend runtime issue: extracted VNEXPRESS dates were timezone-aware while `market_news.published_date` is a legacy naive timestamp column. Patched this as `97fed7f fix(news): normalize vnexpress publish dates for storage`.
- Verification after `686f143`: `pnpm --filter frontend exec tsc --noEmit` passed; scoped backend ruff for changed files passed; `pnpm run ci:gate` passed with frontend lint/build/Jest and 258 backend tests.
- Verification after `97fed7f`: scoped backend ruff passed; `python -m pytest apps/api/tests/test_api/test_news_service.py -v -k "vnexpress or storage"` passed; `pnpm run ci:gate` passed with frontend lint/build/Jest and 259 backend tests.
- Deployed `97fed7f` to OCI `/srv/vnibb`; `docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml ps` showed `vnibb-api` healthy, `vnibb-mcp` healthy, and `vnibb-caddy` running.
- Ran synchronous production crawl: `POST /api/v1/news/news/crawl?sources=vnexpress.net&limit=50&analyze_sentiment=false&async_mode=false`, which returned `Crawled 49 articles`.
- Ran controlled Postgres bridge cleanup for existing VNEXPRESS rows with `published_date IS NULL`: first pass updated 381/415 candidates, retry updated 33/34 remaining candidates, then removed the single malformed blank-title VNEXPRESS row whose URL redirected to the VnExpress home page. Remaining VNEXPRESS article rows with null dates: `0`.
- Final public API smoke at `2026-05-29 01:26:19 +07:00`: `/live` returned alive, `/ready` returned ready, `/orderbook` returned ten `VCI` rows with `price: 25.0`, `price_status: "reference"`, `price_source: "latest_price"`, and `is_stale: true`.
- Final public API smoke: `/foreign-trading?limit=3` returned `2026-05-28`, `2026-05-27`, `2026-05-26` with `meta.symbol: "VCI"` and `meta.last_data_date: "2026-05-28"`.
- Final public API smoke: `/ratios?period=quarter` returned 64 rows, latest `Q1-2026`, and `meta.full_ratio_coverage_starts: "Q1-2024"`.
- Final public API smoke: `/api/v1/news/feed?limit=5&mode=related&symbol=VCI` returned VNEXPRESS rows with concrete `published_date` values such as `2026-05-29T00:05:00`; `/api/v1/news/feed?limit=5&mode=all&source=vnexpress.net` returned zero null dates; `/api/v1/news/world?source=vnexpress_business&limit=5` returned ISO `published_at` values through `2026-05-28T17:05:00Z`.
- Production dashboard browser QA passed against `https://vnibb-web.vercel.app/dashboard`: Template `Use Template` applied an editable workspace, `Save Current` showed visible saved-layout feedback, stale `NASDAQ:VFS` local storage reset to `AMEX:SPY`, and the Crypto tab stayed on BTC/Binance rather than SPY/VFS.
- Production dashboard browser QA passed: Order Book had no `LAST 00` and showed reference `25` prices, Foreign Trading had no `12h old` midnight-age label, Financial Ratios Q mode rendered quarterly data, and News/World News had no visible `Unknown` or `Date unavailable`.
- Screenshot evidence:
  - `output/playwright/vnibb-market-news-date-unavailable-2026-05-29.png`
  - `output/playwright/vnibb-template-library-pass-2026-05-29.png`
  - `output/playwright/vnibb-global-crypto-pass-2026-05-29.png`
  - `output/playwright/vnibb-news-events-pass-2026-05-29.png`

## Final Status

All seven open evaluation report items are patched, covered by focused regression tests where appropriate, committed, pushed, deployed to OCI where backend/runtime changes applied, and publicly smoke-tested. Final Vercel dashboard QA and OCI API smoke checks are green, and the production VNEXPRESS cleanup left zero VNEXPRESS article rows with null publication dates.

## Next-Phase Quality Pass - 2026-05-30

Scope: turn the v1.4.0 remediation fixes into durable product behavior and regression coverage without broad crawler or backend rewrites.

- Template Library: saved-layout persistence now reports a visible, non-destructive error when browser storage writes fail instead of showing false success. Deleting saved layouts also reports success/error inline.
- Dashboard storage: startup now shows a dismissible repair notice when old local dashboard storage is unreadable or when a stale Global Markets snapshot is refreshed. Unreadable dashboard/folder JSON is copied to `vnibb_dashboards_recovery_backup_v1` before defaults load; custom saved layouts are not cleared.
- Order Book: `price_source: "latest_price"` and row `price_status: "reference"` now render as `Reference close`, `Reference pricing only`, and `Ref Price`, with copy stating this is not live bid/ask depth.
- Widget catalog copy: Order Book descriptions no longer promise universal real-time Level 2 depth; they mention cached/reference pricing labels.
- News dates: world-news widgets now show `Date unavailable` for missing timestamps instead of `Live feed`, and the legacy company/market news feed normalizes timestamp aliases before rendering. VNEXPRESS day-first AM/PM timestamp handling is covered in the world-news widget test.
- Focused regression tests added/updated:
  - `TemplateSelector.test.tsx`: visible saved-layout write-failure feedback.
  - `OrderbookWidget.test.tsx`: latest-close reference pricing is labeled as non-live depth.
  - `WorldNewsMonitorWidget.test.tsx`: VNEXPRESS day-first AM/PM timestamp renders without `Date unavailable`.

Verification:

- `pnpm --filter frontend test -- --runTestsByPath src/components/modals/TemplateSelector.test.tsx src/components/widgets/OrderbookWidget.test.tsx src/components/widgets/WorldNewsMonitorWidget.test.tsx src/lib/newsTime.test.ts --runInBand`: passed, 4 suites / 9 tests. Expected local env warning only.
- `pnpm --filter frontend exec tsc --noEmit`: passed.
- `pnpm --filter frontend lint`: passed.
- `pnpm --filter frontend build`: first run failed during prerender because `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` were not set in the shell. Rerun with `NEXT_PUBLIC_API_URL=https://129.150.58.64.sslip.io/api/v1` and `NEXT_PUBLIC_WS_URL=wss://129.150.58.64.sslip.io/api/v1/ws/prices`: passed.
- `pnpm --filter frontend test -- --runInBand`: passed, 11 suites / 28 tests. Expected local env warnings only.
- Public API smoke: `/live` alive, `/ready` ready.
- Public API smoke: `/api/v1/equity/VCI/orderbook` returned 10 rows with `last_price: 24.65`, `price_source: "latest_price"`, first row `price_status: "reference"`, `is_stale: true`, and `market_status: "closed"`.
- Public API smoke: `/api/v1/equity/VCI/foreign-trading?limit=3` returned latest `last_data_date: "2026-05-29"`.
- Public API smoke: `/api/v1/equity/VCI/ratios?period=quarter` returned 64 rows from `Q2-2012` through `Q1-2026`, with `full_ratio_coverage_starts: "Q1-2024"`.
- Public API smoke: `/api/v1/news/feed?limit=5&mode=related&symbol=VCI` returned 5 rows and zero null `published_date` values.
- Public API smoke: `/api/v1/news/world?source=vnexpress_business&limit=5` returned 5 rows and zero null `published_at` values.

### Next-Phase QA Checklist

Use this lightweight checklist after any dashboard template, widget data-label, or news-date change:

- Template Library: from a locked system dashboard, `Use Template` creates and switches to a fresh editable workspace with visible success feedback.
- Template Library: `Save Current` persists a saved layout, displays it under `Your saved layouts`, and shows an inline error if localStorage cannot write.
- Dashboard migration: stale Global Markets localStorage resets to `AMEX:SPY`, Crypto remains `BINANCE:BTCUSDT`, and any repair notice says custom workspaces/saved layouts were preserved.
- Order Book: closed-market `latest_price` fallback shows `Reference close` / `Ref Price` and never reads as true live level-by-level bid/ask depth.
- Foreign Trading: date-only `last_data_date` uses 17:00 ICT settlement semantics and does not show midnight-based stale ages.
- Financial Ratios: quarterly mode renders populated rows or an explicit no-renderable-metrics state.
- Market News and World News: sampled VNEXPRESS rows have concrete dates; missing dates render as `Date unavailable`, never as a freshness claim.
- Production smoke: run `/live`, `/ready`, `/orderbook`, `/foreign-trading`, `/ratios?period=quarter`, `/news/feed`, and `/news/world?source=vnexpress_business` before declaring public PASS.
