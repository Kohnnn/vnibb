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
