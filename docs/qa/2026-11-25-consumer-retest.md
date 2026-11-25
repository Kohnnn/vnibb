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
