# Data trust and workspace completeness

## Goal
Make quote/history price units and historical freshness trustworthy, preserve native workspace state through optional sync, and correct cancellation verification attribution.

## Tasks
- [x] Correct the 5D→3M evidence: chart/transport smoke bypassed the changed hooks. Actual ATR consumer live smoke aborts held VNM history when local symbol switches to FPT; replacement completes.
- [x] Establish source-backed unit contracts for vnstock history, Mongo, PostgreSQL, Redis and screener snapshots. Explicit markers win; verified provider-history lineage converts thousand-VND, generic legacy and unmarked sponsor records remain unknown. No numeric threshold or production rewrite.
- [x] Canonicalize quote/history prices to VND across ingestion and read paths; scale OHLC, previous/adjusted close and absolute change together, leaving percentage/volume unchanged. Keep index points distinct. Explicit VND and legitimate low-VND prices are not scaled twice; analytical consumers retain source lineage and unknown-unit disclosures.
- [x] Replace chart's smaller-close workaround with deterministic history handling and unit-compatible quote merging. Actual browser chart with 58,600/57,300 VND history and an unknown-unit 57.3 quote retained the 57,300 close. Rendered regressions cover adjustment semantics, duplicate dates, timestamps, mixed units and legitimate low prices.
- [x] Carry actual historical observation date and partial/unit/fallback disclosure through ATR's existing runtime and visible metadata. Browser smoke fetched 2025-02-19 observations now and showed that date, Stale, partial coverage and fallback warnings; focused ATR/runtime regressions passed.
- [x] Round-trip `globalMarketsSymbol` and `widgetGroups` through optional dashboard sync, preserving old-record defaults, local-first behavior and imported-dashboard exclusion. Actual hook browser smoke sent and hydrated `NASDAQ:AAPL` and group A `FPT` through intercepted transport; no production write.
- [x] Run focused regressions and repository lint/types; exercise quote/history consistency, ATR freshness, sync reconstruction and live hook cancellation. Final expanded backend suite: 604 passed (one NumPy warning in the stale-peer correlation scenario); frontend: 119 tests passed, TypeScript and production build passed, ESLint zero errors/79 warnings. Changed-line Ruff passed; repository-wide baseline diagnostics remain intentionally unchanged. These are local checks, not hosted CI or production verification.

## Ownership and order
Parent owns contracts, price-unit integration, evidence corrections, docs and final checks. Independent ATR and dashboard-sync edits run concurrently. Price-source investigation precedes unit cutover; final validation follows all edits.

## Safety and acceptance
User authorized commit and redeployment on 2026-10-05 after the local implementation step. No production data rewrite, premium-license bypass or new runtime dependencies. Existing persisted values require explicit unit/provenance handling rather than blind multiplication. Preserve unrelated Matrix readability work. Release requires hosted checks, immutable image identity, rollback preservation and live API/frontend verification. Cancellation of browser fetch does not prove cancellation of provider/database computation.

## Local runtime proof
- Real equity router/cache/history adapters returned quote and last history close of 57,300 VND with HTTP 200; storage/provider seams were injected, not live acquisition.
- Modular daily writer persisted an actual SQLite insert, then refreshed the same natural key while preserving sparse trading value and clearing absent adjusted close.
- Real screener sync persisted free KBS 60.3 as 60,300 VND with matching cache lineage and derived market cap/yield. Unmarked sponsor KBS stayed unknown and produced neither derived value.
- Quant loader with real SQLite history recovered 260 sessions through trusted cache and provider refills. Unknown or missing replacement produced zero usable sessions and explicit insufficient-data estimator responses. No weekend gap inference.
- Browser smoke route and standalone scripts were removed after proof. Frontend production build passed; actual browser chart displayed 57,300 rather than splicing an incompatible 57.3 quote. Smoke authentication emitted Supabase DNS/refresh errors; these checks do not establish live authentication/provider health.
