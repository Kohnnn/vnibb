# Production consumer retest, 25 November 2026

Run these cases after the recovery steps in [the database readiness plan](../../database-readiness-plan.md). Record frontend and API revisions, expected completed exchange session, browser observation time in ICT and dataset observation times. The baseline below was observed on web.vnibb.xyz at approximately 14:27–14:28 ICT with visible version v1.5.0. A frontend commit could not be identified from that label.

| Path | Observed baseline | Evidence required on retest |
| --- | --- | --- |
| Workspace health → Fundamental → Discovery | Prices and all four indices dated Nov 3. Foreign rows through Nov 3, validated through July 2. News through Nov 4. | Compare each dataset to its own source cutoff, completed-session receipt and browser label. Preserve distinct fetch, observation and validation times. |
| Fundamental → Discovery → Listing Browser | 1,757 matches, including AGE marked DELISTED. HOSE 410, HNX 299, UPCOM 811. | Explain the remaining 237 by listing status/exchange. Reconcile the eligible active set separately from the search catalog. |
| Fundamental → Fundamentals → FY, HPG then ACB | Both withhold annual statement fields on unit/basis grounds and display unavailable cash flow. HPG has four years of negative inventory turnover. | Report admitted and withheld field counts by issuer-year and reason. Trace signed inputs or independent source for HPG. Reproduce both ratio-table cases in issue #300. |
| Technical → Trading, ACB | 100 observed trades from Oct 26. Order Book and Intraday Trades unavailable. | Compare sampled window and session metadata to persisted inputs. Check failure and recovery independently for both live feeds. |
| Quant → Comparison, ACB | Correlation has 13 anchor returns and a 20-overlap minimum. Risk unavailable. Relative rotation excludes ACB on price units. RS leaders report 50 unverified prices. | Compare overlap counts, price units and withholding reasons to the served histories. Repeat with a qualified control. |
| Global Markets → Derivatives | Empty contracts and price history, unknown as-of. Analytics shows zero contracts. | Compare active contract membership and source timestamp with the board. Distinguish a verified empty universe from unavailable coverage before interpreting the count. |

Existing issues #173 and #274 retain the readiness and database-wide gates. The browser sample establishes user-visible impact. The production store census, independent provider reconciliation and post-recovery session watch require their own evidence.

## Follow-up at 14:53–14:54 ICT

### Issue [#249](https://github.com/Kohnnn/vnibb/issues/249)

HPG → Fundamental → Ownership → Foreign Trading → 1M. Repeated the selection after leaving and returning. The settled widget said “20 sessions requested” and rendered 60 dated rows (including unavailable rows), 2026-01-30 through 2026-10-27. Aug 21/22/23 each showed buy 1.92M, sell 3.29M, net sell 1.37M at display precision. Ownership now withholds the total, but reports “56/20 sessions observed”. Trace request parameters, response/cache keys, session classification and rendered rows separately. Test switching 3M→1M with a warm cache and a sparse fallback. Count distinct eligible exchange sessions within the claimed interval, count missing/null rows separately, and keep the aggregate unavailable when coverage is insufficient.

### Issue [#173](https://github.com/Kohnnn/vnibb/issues/173)

The saved QA 2026-11-03 Screener workspace contains VniBB Screener Pro. It displayed “Screener unavailable”, N/A matches, as-of unknown and 0/0 core fields, while the same page rendered cached Nov 3 indices and movers. Global Markets → Screener uses TradingView, so it cannot verify the native screener. Include VniBB Screener Pro in the recovery smoke: capture filter/exchange, response status, receipt, exact eligible count, null-price count and as-of, then compare to API/MCP and durable stores. Browser evidence alone cannot identify where the serving path failed.

### Issue [#250](https://github.com/Kohnnn/vnibb/issues/250)

The HPG Market News widget in the saved QA screener shows a “Related to HPG” list containing articles about cholesterol, hernia and corneal disease. Each displayed “Association unverified”; some also displayed “Date unavailable”. This reproduces the relevance symptom even though the old 48/100 score was absent. Trace one served article to its match reason, compare issuer-specific versus general fallback results, keep genuinely linked HPG coverage, and verify unrelated articles no longer appear under an issuer-specific heading. Actual live matching mechanism remains unverified.

## Workspace health and Settings acceptance

Reviewed main at c2176456ff5af66f65c8a8129b1a7e3666708b3e against the 25 Nov Workspace Health and Settings output supplied by the user. Source review and isolated helper checks only. No assumption that the serving frontend matches this SHA.

| Area | Code evidence and reproduction | Acceptance |
| --- | --- | --- |
| Next sync | `apps/api/vnibb/api/v1/market.py` returns literal `_PUBLIC_SOURCES[*].next_sync` strings. `DataSourcesHealthPanel.tsx` prints them under “Next sync”. No scheduler state enters that query. | Label configured cadence explicitly. Show an actual next run only with scheduler evidence. Exercise stopped, enabled, and unknown scheduler states. Refresh polls diagnostics and must never trigger ingestion. |
| Corporate actions and future timestamps | Settings applies the same age classifier to MAX(event_date) as to past observations. Executing the source helper with age −90, thresholds 14/60 returns fresh. Executing the UI age formatter gives “today”. A future event is legitimate; the date cannot certify ingest health. A future-dated price observation also falls through to fresh. | Show future scheduled events as upcoming with the actual date; measure sync health independently. Treat implausible future observations by field semantics with an explicit timezone/clock tolerance. Test yesterday/today/tomorrow and +90 days. |
| Foreign data drill-down | Workspace filters raw rows to non-null net volume or value and computes the latest eligible date among its completed settlement dates. Settings takes unrestricted MAX(trade_date), exposes raw scope and omits validated cutoff. | Carry raw latest, usable latest and validated latest into the detail view with clear definitions. Test a newer null-only row and missing/gapped receipts. Use “latest validated date” unless continuity is proven. |
| Market news | `_load_market_news_freshness` returns MAX(published_date) and MAX(crawled_at) independently over all rows. Both can belong to different articles. Settings formats times in browser locale without timezone. | Label both as dataset maxima or link crawl time to the identified article if implying a pair. Provide timezone. Test two articles with opposite max order and a missing crawl timestamp. |
| Ratios/shareholders | Both use MAX(updated_at), stale threshold 30 days. Isolated source helper returned fresh at age 22 for ratios (critical 90) and shareholders (critical 180), while daily prices returned critical (2/7). | Preserve storage scope, show the applied threshold and distinguish last write, last successful run, fiscal/disclosure period and coverage where available. A single touched row must not certify the universe. |

Workspace/API reachability, dashboard persistence and freshness already have separate signals. Keep those semantics. `apps/web/src/lib/backendHealth.ts` checks HTTP success of health and VNM ratios only; an empty 200 passes. `DashboardHealth.tsx` maps backendSync local/idle to the device label. Show scope of the probe if needed; preserve strict readiness in #173. The Settings provider control exposes a single VCI preference; use #241 for effective provider evidence. MCP catalog is static and does not execute tools; the ~1.3M EOD row count is static descriptive text. If retained, date/source the estimate.

Track implementation and retest evidence in [#305](https://github.com/Kohnnn/vnibb/issues/305).
