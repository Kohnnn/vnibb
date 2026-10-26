# Database readiness resolution — #129

## Goal and baseline
Make current-session data durably complete, correctly published and repeatably usable; do not turn health green by relaxing its meaning. Planning only: no acquisition, production writes, scheduler enablement or redeployment authorized here.

Live `/api/v1/health/detailed` at 2026-10-26 11:22 UTC on `229d7a54`: DB/Redis healthy; overall **degraded**, `verified_universe_unavailable`, zero verified rows, expected session October26, verified2026calendar, no provider coverage. Zero verified rows is not zero stored rows. Prior isolated native replay passed 1,519 captured records, including 647 null actual prices; it was not production recovery. Existing measured readers do not justify new indexes or replacement infrastructure.

## Ordered work and acceptance
- [ ] **1. Read-only census.** Pin revision/session and current active membership. Reconcile Mongo raw envelopes, PostgreSQL session/price/snapshot rows, completion receipts and cache. Acceptance: exact per-symbol missing/stale/invalid reasons; durable rows counted separately from health's admitted view. Recount membership rather than freezing 1,519.
- [ ] **2. Source permission and coverage.** Recover source-policy evidence; establish affirmative storage/public-serving permission or use an authorized exchange/licensed feed. Record exchanges, instrument types, regular/odd-lot/put-through scope, finality and dated suspension/no-trade authority. Acceptance: retained permission/coverage evidence, not anonymous endpoint accessibility.
- [ ] **3. Offline admission repairs.** `data_pipeline.py:1432-1476` rejects a whole batch for one bad row; Mongo retention failure only warns. Raw-before-qualification retention is a proposed repair, not current behavior. Add failing regressions first against disposable MongoDB/PostgreSQL: (a) 50 requested symbols with one invalid row retain the received envelope and 49 independently valid observations, reject the invalid symbol and publish no completion receipt; (b) a partially applied Mongo write leaves affected observations uncertified and no completion receipt; (c) replaying identical input changes neither durable natural-key counts nor admitted values/lineage and cannot turn incomplete coverage complete. Reject duplicate/ambiguous symbols; reconcile existing `session_errors`/progress counters with requested, admitted and failed sets. Existing `test_pipeline_session_acquisition_is_opt_in_and_clears_unqualified_quotes` covers valid input and a failed fetch with Mongo disabled, not these failure semantics. No new retry policy or health endpoint is assumed necessary.
- [ ] **4. Failure-safe publication.** Reuse snapshot upserts and `screener_universe` receipt (`data_pipeline.py:2147-2204`). Require exact active membership and durable raw/session/price lineage. Acceptance: interruption, active-set drift, same-day rerun and cache failure cannot expose partial rows as a completed cohort or contaminate the last admitted cohort. Add run isolation only if these checks demonstrate a gap.
- [ ] **5. Bounded production recovery.** After 2–4: fresh paired backup plus off-source restore proof; acquire/import authorized missing observations, materialize through the existing pipeline, reconcile durable rows, publish receipt, refresh cache. Existing entrypoints do not expose `acquire_sessions=True`; reuse the method through one narrowly scoped operator command. Acceptance: exact membership, source/session/unit lineage and idempotent rerun; no fake OHLC, restamped dates, manual completion markers or history deletion.
- [ ] **6. Sustainable daily owner.** After one accepted recovery and permission: connect the existing scheduler to the authorized acquisition/import stage before retained materialization. Reuse locks/deadlines/outcome records; keep ratio enrichment outside the base-data critical path and unrelated callers' `acquire_sessions=False`. Acceptance: next completed session updates automatically; failures preserve honest stale disclosure and no competing producer.
- [ ] **7. Consumer/watch verification last.** Match admitted Mongo/PostgreSQL/Redis data to actual screener/API/MCP and browser counts, sampled values, null prices and as-of dates. `health.py:266-268` deliberately degrades provider-board cohorts: accept broader coverage only through genuine supporting evidence, not by removing that guard. Acceptance: unchanged strict off-box watch passes after real recovery and the following scheduled session succeeds. Close #129 from that evidence; unrelated research gates remain separate.

## Dependencies and stop conditions
Run the source-permission track (2) alongside the read-only census (1) and offline admission work (3); publication checks (4) follow the relevant admission changes without waiting for source permission. Production recovery (5) requires 2–4; scheduling (6) follows 5; consumer/watch verification (7) is final. Stop publication for missing permission, ambiguous identity/units/finality, any active-member gap or nondurable lineage. Provider-board zero volume is not whole-market no-trade; 647 null prices must not become zero/fresh OHLC. Preserve admin/no-send/external-client gates, protected stores/credentials and the accepted immutable deployment.

**Smallest useful milestone:** a source-authorized complete provider-scoped cohort with real production consumer proof. This restores that scope, not whole-market readiness. Whole-market green additionally requires a broader supported coverage contract and repeatable ingestion; redeployment cannot supply either.

## Ticket graph

GitHub parent: [#129](https://github.com/Kohnnn/vnibb/issues/129). Integration branch: `codex/129-database-readiness-20261026`.

| Step | Ticket | Blocked by |
| --- | --- | --- |
| 1 | [#167](https://github.com/Kohnnn/vnibb/issues/167) | — |
| 2 | [#168](https://github.com/Kohnnn/vnibb/issues/168) | Source-owner permission and coverage evidence |
| 3 | [#169](https://github.com/Kohnnn/vnibb/issues/169) | — |
| 4 | [#170](https://github.com/Kohnnn/vnibb/issues/170) | #169 |
| 5 | [#171](https://github.com/Kohnnn/vnibb/issues/171) | #168, #169, #170 |
| 6 | [#172](https://github.com/Kohnnn/vnibb/issues/172) | #168, #171 |
| 7 | [#173](https://github.com/Kohnnn/vnibb/issues/173) | #171, #172 |

## Implementation evidence — 26 October 2026

- **Census (#167):** fresh bounded, provider-free datastore reads at 12:26:27–12:26:32 UTC pinned serving revision `229d7a54b4aec6622bbaec92680a60ae48b729b2`. Recounted 1,519 active symbols; PostgreSQL retained 1,414,178 prices and 318,202 snapshots. Only 872 symbols had current actual price dates. Current board envelopes, qualified board records, embedded SQL session records, completion receipts and admitted Universe rows were all zero. Stored rows are not admitted coverage. The read-only census and preflight regressions passed 12 checks; no store or container identity changed.
- **Permission (#168):** no affirmative storage/public-serving grant is retained. [Vietcap terms](https://www.vietcap.com.vn/dieu-khoan-su-dung-chinh-sach-bao-mat) reserve rights and restrict copying/distribution/publication beyond personal download/printing. HNX asks users to contact the exchange before publishing website information; its [disclaimer](https://hnx.vn/khuyen-cao.html) is not a redistribution license. Keep source use default-deny pending an applicable owner/license grant and a source-backed exchange/instrument/segment/finality/no-trade contract.
- **Production (#171–#173):** acquisition, writes, scheduling and redeployment remain unperformed. A successful code merge cannot close the strict-watch alert or establish the following scheduled session.
- **Offline admission/publication (#169/#170):** integration source `4611438bbd95d79db91a38fb61c0a752abcd8a20` passed 184 affected default-mode checks and 25 native PostgreSQL 17/MongoDB 7 checks. The independent real-store pipeline/CacheManager/API/Redis smoke retained 49 valid observations and no completion receipt for invalid 50-symbol input; complete input admitted 50 rows, including two null actual prices, and identical replay preserved values/lineage. The actual census reader and JSON snapshot reconciliation changed from zero to 50 admitted/qualified rows without whole-market certification. SQLite cancellation after 40 rows and at final commit preserved the previous cohort; retry with the same progress and sync identifier completed the cohort. Changed-line Ruff reported zero owned diagnostics; unrelated legacy diagnostics remain.


