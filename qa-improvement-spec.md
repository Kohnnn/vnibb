# VNIBB QA improvement specifications

Status: approved contracts; source implementation and investigations recorded below, with production acceptance, provenance, and external prerequisites still distinguished. Date: 18 October 2026. Execution order: [qa-improvement-plan.md](qa-improvement-plan.md).

## Evidence and limits

- Tracker: [QA map #111](https://github.com/Kohnnn/vnibb/issues/111), original #98/#100–#110 and MCP follow-ups #115–#123; #94/#97 are existing related owners. Original report: `docs/qa-deployed-2026-10-08.md`. Historical source/replay detail: `qa-ticket-plan.md`. Later database/MCP recovery and deployed checkpoints: `mcp-database-qa-plan.md:123-144`. Later dated observations supersede early blockers; checked source tasks are not ticket closure.
- Last complete deployed MCP run at `1520862`: 340 real calls across 20 tools; check outcomes 156 PASS, 151 PARTIAL, 3 FAIL, 2 BLOCKED, 2 UNSUPPORTED. Gates 1 FAIL; 2/3 PARTIAL; 4/8 PASS; 5/7 BLOCKED; gate 6 offline not re-exercised. Three failures concern historical SQL price-unit provenance. No fresh complete MCP tally was produced in this planning pass.
- Fresh public reads captured `2026-10-17T17:59:32Z`: `/health/` returned revision `f3ee893c83859035711ecec8c47f17395cbf80e9`, PostgreSQL/Redis connected and free VCI; API and web readiness returned 200. This supersedes old SSH/`2c576542` release blockers, not financial acceptance. Frontend commit identity was not established by readiness.
- Fresh Chromium at `https://vnibb-web.vercel.app/dashboard?dashboard=default-fundamental&tab=tab-default-fundamental-fundamentals&symbol=FPT`, 1440×1000: FY/Q selected matching periods in all four statement/ratio widgets. TTM ratios explicitly unsupported with no ratio request; three statement TTM requests returned 200 with `missing_quarterly_source_data`, not invented values.
- FY FPT screen showed P/S 600× and EV/Sales 160× adjacent-period warnings, P/E 2020 `0.03` versus 2022 `14.64`, and 2025 Dividend Yield `47.02%`. These are observed values, **not proof of provider error**. Cost of Revenue used “loss widened”; Debt/Equity “to loss”; Investing CF “to profit”. This wording implies earnings for non-earnings metrics.
- Four financial tables measured 535 px viewport widths, content 805–1069 px and rightmost scroll offsets 270–534 px, with `role=listbox`, `tabIndex=-1`. Screenshot showed partial preceding-period cells. Rightmost positioning may be intentional latest-period behavior; do not classify all horizontal overflow as a layout bug without keyboard/scroll replay.
- FY Balance Sheet returned 200 in 25,291 ms. Fundamental Analysis aborted twice around the configured 20,000 ms client deadline and rendered unavailable. Causes are unproven; increasing timeouts is not a diagnosis. Source-health returned 200 but Kalshi was stale with zero snapshots and PredictIt empty with 20 synthetic records, not healthy provider completeness.
- Session screenshots: `/tmp/omp-sshots-15aa0e650d491485.webp` (FY), `/tmp/omp-sshots-15aa0eb6a0491486.webp` (quarter loading transition). These are local session artifacts, not durable release proof; the second does not establish a persistent spinner. No mobile, currency-switch, Matrix, all-ticket or multi-browser pass is claimed.

## S1 — Exact-release acceptance baseline (P0)

**Tickets:** #110/#111, with per-check attribution to #98, #103, #105, #107, #115–#123. **Problem:** old source-only results and later deployment records coexist; open tickets alone do not prove original defects remain.

**Change:** reuse the existing MCP acceptance harness and trusted-TLS authenticated read path. Record exact arguments, revision/digest/schema head, selected store, returned counts, lineage and reason codes. Classify checks individually; source-only, deployed pass, partial, failed and external blocker are distinct. Reconcile outcomes into existing issues without resetting original evidence. Keep frontend identity separately unknown until established.

**Seams:** `apps/api/tests/test_api/test_mcp_acceptance.py`, `test_mcp_server.py`, `test_mcp_sql_contracts.py`; `apps/api/vnibb/mcp/server.py`; existing private acceptance runner referenced by `mcp-database-qa-plan.md`.

**Acceptance:** all 20 tools invoked with bounded retained-data reads; all expected checks accounted for, including offline gate 6; no source assertion upgrades a live result. #115 lossless fields/strict JSON, #116 executed date/filter/sort constraints, #117 no recursion, #118 failure-versus-empty, #119 scope and #121 envelope identity are reaccepted, not rebuilt unless reproduced. No credentials enter reports. Gate names/counts distinguish calls from check rows.

## S2 — Historical price trust (P0)

**Ticket:** #98, related #105/#123. **Problem:** recent SQL windows include legacy `source=vnstock` rows without persisted original unit/raw columns; new explicit-VND EOD observations do not certify those older rows.

**Change:** inventory failing row identities and locate original row-linked source/unit evidence, including session/adjustment basis. Certify only observations with adequate evidence using the existing admission path. If no evidence exists, keep calculations unavailable and document the exact prerequisite; do not relabel, rescale, replace history or weaken acceptance to force green.

**Seams:** `apps/api/vnibb/services/ai_context_service.py`, `apps/api/tests/test_api/test_snapshot_price_safety.py`, MCP SQL/acceptance tests and existing price-admission tests.

**Acceptance:** MSR/VNM/VCB windows preserve all retained dates and explicit unknowns. Missing/nonfinite bars cannot shift the meaning of a 20-session horizon or create Infinity/NaN; incomplete/uncertified series withhold derived signals. Fresh certified observations remain usable, genuine large movements are not rejected by magnitude alone, and historical source identity is not inferred from a different store's numeric agreement. Permanent regression covers a consumer-visible horizon/unit failure, not serialized wiring.

## S3 — Financial value, unit and period reconciliation (P0)

**Tickets:** #100/#101/#103/#106/#121; #104 arithmetic consistency. **Problem:** the FPT FY UI contains extreme ratio discontinuities while retained IQ monetary scales/reporting basis remain partly unknown; UI/provider fallback and admitted SQL/MCP reads need an explicit serving-path reconciliation.

**Change:** start with FPT FY2020–2022 P/E/P/S/EV-Sales and FY2025 Dividend Yield. Trace each selected value to its exact source record, descriptor, fiscal identity, units/scale, denominator and adjustment basis. Compare SQL/MCP/API/table/chart without treating different source/period records as the same observation. Fix only the proven mapping/calculation/admission defect; retain raw evidence and unknown fields. Do not use swing warnings as certification or automatic correction.

**Seams:** `apps/api/vnibb/api/v1/equity.py` financial merge/TTM builders/ratios endpoint; existing decoder/provider financial tests; `apps/web/src/components/widgets/FinancialRatiosWidget.tsx`, statement widgets, `apps/web/src/lib/units.ts` and fiscal-period helpers.

**Acceptance:** every sampled value has a source-backed explanation or explicit unavailable reason. Monetary and percentage conversion requires declared units, with one conversion only; dimensionless ratios do not receive currency conversion, and per-share values use the matching fiscal-year rate. FY/Q shared state survives symbol changes/reload/local overrides. TTM ratios remain unsupported without a request; TTM flow calculations require four compatible quarters and known flow basis; balance TTM uses the compatible latest stock observation when available. Zero differs from missing; fiscal conflicts are not averaged; basic EPS never substitutes for diluted EPS. Use FPT/VNM/MSR/VCB bounded samples and existing tests for absent live transition fixtures. No financial-data correctness claim from HTTP 200 alone.

## S4 — Financial comparison language and table navigation (P1)

**Tickets:** #104/#108 plus regression #101/#102/#109. **Problem:** shared numeric sign classification currently labels all negative metrics as profits/losses; default latest-period scrolling can expose partial cells without clear navigation.

**Change:** preserve absolute-prior arithmetic, but apply earnings terminology only to identified earnings metrics. Other rows use neutral signed change/direction language with no implied profitability or desirability. Use existing metric definitions; no global toggle or one-implementation abstraction. First prove keyboard/pointer access to all period columns; make the minimal affordance/focus/alignment correction if inaccessible or ambiguous. Preserve intended newest-on-right ordering, sticky labels and saved geometry.

**Seams:** `apps/web/src/lib/units.ts:420-510`; `apps/web/src/components/ui/DenseFinancialTable.tsx`; `apps/web/src/components/widgets/FinancialsWidget.tsx`; existing table/widget/helper tests and `apps/web/scripts/qa-live-smoke.mjs`.

**Acceptance:** net-income loss narrowing/widening and sign crossings stay correct; costs, leverage, cash flows and turnover never say “profit” or “loss” merely because their sign changes. Table and Growth Bridge use compatible percentages. At 1440×1000 and a narrow supported breakpoint, every period and its full value can be reached by pointer and keyboard, the sticky metric remains readable, and focus is visible. Do not force all years into the viewport or remove dense data. No-tab/invalid-tab navigation, Back/Forward, no-results/Escape focus, blank workspace and persisted layout/ticker state retain their existing behavior. Use disposable browser-local workspace changes only.

## S5 — Slow reads and honest freshness (P1)

**Tickets:** #105/#106/#107/#109. **Problem:** user-visible unavailable states occur after repeated ~20 s Fundamental Analysis aborts; one FY Balance Sheet read took ~25 s. Fresh fetch/storage timestamps cannot establish source freshness or complete data.

**Change:** collect section timing from existing request/log surfaces for one bounded cold and warm request; distinguish SQL, provider read-through, aggregation and client retry behavior. Select the smallest fix supported by the measurements: reuse already retained observations or bound an optional section through existing partial-result semantics when applicable. Do not add retries, global caching infrastructure, new telemetry or a larger timeout without evidence. Align Settings/banner/widget source-date, fetched-at and validation-date labels with their actual basis.

**Seams:** `apps/api/vnibb/api/v1/equity.py:5115-5193`; `apps/web/src/lib/api.ts:468-472`; `apps/web/src/lib/queries.ts:118-126`; `apps/api/vnibb/services/data_quality.py`; `apps/api/vnibb/api/v1/market.py` freshness report; `FreshnessBanner.tsx`, `DataSourcesHealthPanel.tsx`.

**Acceptance:** representative retained-data requests settle with data or a truthful partial/unavailable response before the current 20 s client deadline; bounded slow-dependency exercise preserves useful independent sections or reports their specific failure without fabricated metrics. Cancellation/retry cannot leave stale successful status. If that target requires an unsupported contract, document the measured blocker rather than silently changing the deadline. Advancing fetch/storage time never advances source as-of/validated-through; unknown remains unknown and “Live” cannot contradict stale source evidence. No timeout increase is accepted as the sole fix.

## S6 — Bounded acquisition and source coverage (P1)

**Tickets:** #97/#107/#120/#122/#123, related #105. **Problem:** completed first pass is not complete acquisition: recorded 7,893 succeeded, 2,100 empty, 2,175 failed pairs. Recovery retained 2,197 unit/date-blocked source records and conflicting keys. Historical scheduler failures and provider denials remain observable.

**Change:** provider-free receipt/log/source inventory first. Classify genuine empty, unsupported, timeout, denial, transform rejection, conflict and withheld units. Attribute known retained-data recoveries separately; never rewrite original failed/empty receipts into successes. Run a bounded continuation only after actual provider ownership is established and only for the selected authorized scope; no blanket retry of terminal pairs. Treat source-specific problems independently.

**Seams:** `apps/api/vnibb/core/scheduler.py`, existing source-reference/EOD/trading services; `apps/api/tests/reference_acquisition_receipts.py`, `test_trading_acquisition_coverage.py`; `apps/api/tests/test_api/test_supplemental_universe_receipts.py`, `test_eod_discovery_resume.py`, `test_eod_catchup_scheduler_owner.py`, `test_transaction_flow_coverage.py`; `apps/api/tests/test_services/test_trading_pipeline_coverage.py`.

**Acceptance:** canonical universe denominator and selected work subset are distinct; stage receipts reconcile without skipped tails or duplicate owners. SQL/Mongo counts and sampled/complete transaction totals remain independent and source-linked. Unknown dates/ownership rates are not invented. Retention remains 4 GiB catalogue/1 GiB combined snapshots, hourly at :40 with at most 12×5,000 catalogue rows, 30-day daily/seven-day intraday history; terminal/archive/synthetic protections remain. PredictIt HTTP 403 or another provider failure cannot disable pruning or trigger fixture history. Automatic stock-history deletion remains disabled. Archives/WAL/backups are outside admission limits and must not be represented as a filesystem quota.

## S7 — Genuine-user Matrix acceptance (P1, external prerequisite)

**Tickets:** #94/#98/#110, related #117. **Problem:** historical acceptance lacked two verified disposable user sessions/exact fixtures; a prior issuer lookup returned NXDOMAIN. Current issuer reachability has not been rechecked in this pass.

**Change:** verify configured issuer and existing project status without changing ACLs or substituting identity. Resolve only the actual infrastructure prerequisite, then provision two genuine disposable sessions and authorized fixtures using existing setup. Shared MCP bearer is not a user JWT. Do not create a mock authentication path to close a production gate.

**Acceptance:** exact owner reads succeed; other-owner, missing/invalid/revoked/logout sessions fail without data disclosure; selections remain exact and sidecar recursion absent; export denial remains enforced without supplier rights. Positive export requires real authorization. Delete only owned disposable fixtures after proof. Keep the gate BLOCKED, with exact missing prerequisite, until real user/session scenarios run. Never store JWTs in docs/logs.

## Ticket coverage and delivery gate

| Existing ticket | Planned owner/spec | Closure evidence |
|---|---|---|
| #98 | S1/S2/S7 | Price-unit/horizon proof; genuine identity gates remain separate |
| #100 | S3 | Monetary/per-share table/axis/tooltip currency parity |
| #101 | S3/S4 | Shared FY/Q/TTM, reload/symbol/override replay |
| #102 | S4 | No-tab/default/remembered/invalid and Back/Forward replay |
| #103 | S3/S1 | Canonical fiscal identities, conflicts, zero/null, exact filters |
| #104 | S3/S4 | Consistent arithmetic plus metric-appropriate sign language |
| #105 | S1/S5/S6 | Source/receipt/storage/validation clocks remain distinct |
| #106 | S3/S5 | Source-backed ratio/valuation/peer/Sharpe-basis adjudication |
| #107 | S5/S6 | Sparse/empty/stale/unavailable and news association remain explicit |
| #108 | S4 | Pointer/keyboard geometry and reachable narrow-table columns |
| #109 | S4/S5 | Drawer focus, signed footer, blank workspace and transient recovery |
| #110/#111 | S1/final gate | Runtime-bound evidence plus explicit untested-surface register |
| #115/#121 | S1/S3 | Lossless fields/envelopes/fiscal identity with strict JSON |
| #116/#119 | S1 | Applied/rejected predicates, date bounds and dataset scopes |
| #117/#118 | S1/S7 | No recursive self-call; errors never become successful empties |
| #120/#122/#123 | S6 | Universe, continuation and source-linked coverage receipts |

For #106 also retain the original peer cohort/Sharpe parameter uncertainty: compare only identical source, period, cohort, risk-free rate and sampling basis. Do not invent the missing original parameters. For #110 retain untested mobile/zoom/accessibility/multi-browser, backup/saved-view/cross-device, template/edit permutations, ticker groups, charts/embeds, AI/security/performance scenarios; execute release-critical affected surfaces, not claim the whole register passed.

At implementation: preserve unrelated changes; use existing dependencies and seams. Keep one meaningful failing-before/passing-after regression per confirmed consumer-visible bug, not source-text or mock-wiring assertions. Run targeted existing tests and TypeScript at integration points. Freeze source; run the existing `pnpm run ci:gate` once with the repository Python environment; independently review standards and spec compliance. Then exercise changed browser/API/MCP paths on the exact release with trusted TLS, recording limits and blockers before commit/authorized deploy. Planning alone requires no build/test run or application-code changes, and closes no issue.

## Execution status — 18 October 2026

This status supplements, and does not relax, the acceptance contracts above. Evidence labels are explicit: **source implementation/investigation** is not production acceptance; **production acceptance** used old deployed release `f3ee893c83859035711ecec8c47f17395cbf80e9`; **local changed-source smoke** is not deployment. See [qa-improvement-plan.md](qa-improvement-plan.md#execution-evidence--18-october-2026) for concise execution evidence and retained artifact locations.

- **S1 — Partial:** production old-release acceptance invoked all 20 tool IDs across 340 calls: 150 PASS, 157 PARTIAL, 3 FAIL, 2 BLOCKED, 2 UNSUPPORTED check rows. Gates 1 FAIL; 2/3 PARTIAL; 4/8 PASS; 5/7 BLOCKED; 6 offline/untested. This is not acceptance of changed source.
- **S2 — Investigation complete; acceptance blocked:** price-unit provenance absent for historical rows. Do not certify from new Vietcap VND bars or rescale.
- **S3 — Source changes implemented; data/UI provenance unresolved:** explicit percentage metadata, zero/fiscal identity handling and unsafe synthesis corrections are in source. Final focused backend run 124 passed; prior broad run 295 passed. SQL/Mongo/UI records do not establish the FY2020 or FY2025 anomalies' original-serving provenance; descriptors remain unavailable. No data write or scale correction.
- **S4 — Source implementation and local changed-source smoke:** metric-appropriate neutral language and keyboard/pointer accessible period scrolling observed at desktop and narrow sizes. Local changed webpack UI used production API; no app deployment or full ticket replay claimed. Existing UI regressed boundaries, saved geometry and untested-surface register remain acceptance obligations unless parent provides further evidence.
- **S5 — Source implementation and bounded-read evidence:** old-production Balance Sheet cold/warm took 10.532/9.916 s with IQ conflict partial data; aggregation took 19.296 s partial, then 30.004 s (504). Changed-source ASGI smoke settled one stalled section in 1.289/1.277 s and all 11 in 13.783 s at the default budget, HTTP 200 with truthful partial errors and preserved independent sections/source dates. No providers were called. Separate real SQLite/session smoke reproduced finalizer failure; bounded invalidation after failed rollback fixes it. All six deadline/session regressions passed. Freshness clocks remain distinct.
- **S6 — Investigation complete; acquisition acceptance blocked:** first-pass receipt counts and conflict/withheld records remain immutable. Retained scheduler window establishes PredictIt 403 (three attempts); Kalshi/Limitless catalogue/source-cap admission blocks are distinct warnings, and failures are source-specific. Provider ownership is unconfirmed; no continuation or history deletion.
- **S7 — Issuer correction, real-user direct gates, and cleanup complete:** canonical issuer correction and auth-only rollout. Two disposable users and exact owner/other/revoked/logout/export scenarios exercised; direct S7 gates passed. Logout sessions returned 204 then issuer 403 and API/MCP 401; refresh returned 400 for each. Five guarded `app_kv` rows with exact keys and both disposable users were deleted and verified; users return 404. Private session/fixture/staging data removed; only redacted evidence retained. No supplier export-rights claim.
- **S1 rerun:** later full rerun produced no result after JavaScript worker reset; no new tally. Retained production old-release 340-call result above remains S1 evidence.
- **Final source verification:** 42 focused Jest tests and six deadline/session tests passed. The integrated gate ran once: lint (79 warnings), TypeScript and webpack build passed; 1,118 frontend tests passed and one stale accessibility selector failed, then its corrected 31-test file passed. The remaining full backend run returned 3,048 passed, four skipped and two obsolete synthesis expectations; all four cases in their migrated certified/unverified contracts passed. Final changed-line Ruff passed. No all-green full rerun is claimed. Independent standards/spec reviews found no remaining scoped source findings.

Ticket closure remains blocked wherever original acceptance criteria or provenance remain unresolved. Disposable Matrix cleanup is verified. The original untested-surface register at §Ticket coverage and delivery gate remains intact; no full integrated pass or application rollout is claimed.

## Exact-release deployment and live followup

The later [redeployment QA record](qa-improvement-plan.md#redeployment-qa--18-october-2026) supersedes the old-release and no-rollout statements above for application `74144b4b5af8cf77cecf22b2625796370fe3eac7`. API/MCP/scheduler and both frontend aliases have exact immutable release identity; all nine integrated gates and 649 offline MCP regressions passed. Deployed UI/API checks preserve explicit source/provenance limitations; detailed health remains degraded for stale source data, not container readiness.

Live acceptance found additional scoped defects in palette focus restoration, explicit local period configuration, partial-section warning visibility, unsupported TTM callers, and retained valuation admission. Their focused regressions and provider-free ASGI checks pass after source fixes. Followup integrated verification, review and rollout remain separately recorded; no historical data certification, provider continuation or blanket ticket closure follows from these fixes. Original untested surfaces and supplier-rights prerequisites remain controlling.

Followup source `626434af2b762737f7ec6183053d01dd3cf03d5d` is now deployed on API/MCP/scheduler and both frontend aliases. Native desktop/narrow browser replay passed all newly repaired paths; actual aggregate and enriched-screener reads withhold uncertified legacy valuation while preserving raw evidence and independent content. Standards and spec reviews found zero scoped issues. The followup full gate passed frontend checks and 3,057 backend tests but exposed three outdated deadline-control fixtures; their evidence-only migration preserved assertions and the six-test deadline suite passed. No fully green full rerun is claimed. Exact-release MCP population acceptance remains separately pending; prior incomplete transport output cannot establish it.

Final exact-`626434a` MCP acceptance completed 340 actual calls across all 20 tools: 150 PASS, 157 PARTIAL, three FAIL, two BLOCKED, two UNSUPPORTED check rows. Only MSR/VNM/VCB aggregate price-unit uncertainty failed; transport and unexpected tool errors were absent. Gates 1 FAIL, 2/3 PARTIAL, 4/8 PASS, 5/7 BLOCKED; 649 offline regressions remain separate gate-6 evidence. Current-release genuine-user Matrix scenarios and supplier-positive export remain untested without new authorized fixtures/rights. Complete read-only execution is not a full data-trust pass or ticket closure.

Advisor followup source repairs the remaining dividend consumer double conversion: Key Metrics, Price Chart and Share Statistics admit only explicitly certified percentage points, preserve zero, skip unknown/missing-unit candidates and retain their existing source precedence. Canonical dividend formatting has no magnitude inference or arbitrary yield ceiling; endpoint-computed dividend percentages remain directly formatted. Bank Metrics now preserves missing versus zero at its table formatting boundary. All 84 focused tests and controlled actual-widget browser scenarios passed; standards/spec review has no remaining findings. Integrated gate results are recorded in the [advisor followup evidence](qa-improvement-plan.md#advisor-dividend-followup--18-october-2026). This is source/consumer proof, not a deployment or provider-data certification.

The remaining endpoint-consumer audit found and fixed News + Corporate Actions and Dividend Ladder using a fraction-inference formatter on explicitly computed percentage points. Both now reuse the canonical dividend formatter, preserving `0.25%`, `1.00%`, zero and omission of missing yield labels without changing payout amounts or dates. The 11 consumer regressions, typecheck and actual-dashboard controlled browser smoke passed; independent standards/spec reviews have no findings. Release evidence is tracked in [remaining dividend endpoint consumers](qa-improvement-plan.md#remaining-dividend-endpoint-consumers--18-october-2026); backend source and data-trust blockers are unchanged.

Frontend `e5a244624a40e6503191ff8fa1c9e046fb97c97c` is now deployed as Vercel `dpl_3yjgeLcXJ9f1hUBxX2AeGQjw7VRL` on both canonical aliases, including the earlier dividend/bank repair. Exact commit/archive metadata and readiness/liveness passed. Production HTML/assets passed 22 controlled browser scenarios across six widgets; these fixtures certify consumer behavior, not provider observations. The nine-stage gate passed with 1,192 frontend and 3,060 backend tests. Backend `626434a` and all protected container identities remain unchanged with zero restarts; historical data, acquisition rights and current-release Matrix prerequisites remain unresolved. The [deployment record](qa-improvement-plan.md#remaining-dividend-endpoint-consumers--18-october-2026) supersedes prior frontend not-deployed statements only.
