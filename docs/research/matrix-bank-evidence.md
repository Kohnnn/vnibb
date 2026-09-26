# Matrix bank evidence: availability is not comparability

Research resolution for [#50](https://github.com/Kohnnn/vnibb/issues/50), within the [Matrix map #35](https://github.com/Kohnnn/vnibb/issues/35). Research date: 2026-09-26.

- Isolated remote branch: `research/matrix-bank-evidence`.
- Recorded base and code evidence pin: `20fa4c392e22a42b2d150de22989bb2331a98adb` (branch claim recorded in #50 before research; remote ref checked against this pin).
- Deliverable: specification evidence only. No application changes, live market/provider/AI calls, production database queries, PDFs, builds or tests. No bank ticker-period coverage is asserted.
- Banks, insurers and securities companies are separate later-stage playbooks. The confirmed first implementation remains the non-financial quality playbook. None of the candidate dimensions below approves Matrix columns.

## Resolution

VNIBB has a bank-aware **read-time derived analytics path**, but not a frozen bank observation contract. It can potentially recover bank statement amounts and derive eight bank fields. P/B and ROE also have normalized paths. Neither a field declaration nor arithmetic code proves live coverage, an issuer-reported ratio, audit status, regulatory comparability, or redistribution rights.

The most consequential semantic trap is `provision_coverage`: the current formula divides loan-loss reserves by **gross loans**, not NPLs. It is not evidence of NPL coverage. `equity_to_assets` is accounting leverage, not CAR. `loan_to_deposit` is a simple accounting ratio, not demonstrated SBV regulatory LDR. NIM uses a VNIBB-selected earning-asset denominator; it is not proven equivalent to an issuer's NIM. [C1][C2]

Research-feasible candidates are common-year accounting amounts and transparently defined accounting ratios, **conditional** on field identity, basis, units, denominator completeness and lineage. Reported NPL/coverage, CAR/CET1/Tier 1 and regulatory funding/liquidity dimensions are blocked for an exact, defensible Matrix contract by the missing mappings/basis evidence described here—not proven absent from all upstream sources.

## 1. Eligibility and comparison population

The API determines bank-like status by accent folding and substring matching industry/sector text against terms including `bank`, `banking`, `commercial bank`, `joint stock commercial bank`, and `ngan hang`. It checks `Stock.industry/sector`, then the latest `ScreenerSnapshot.industry`. This is a classification heuristic, not an SBV licence check, immutable company type, or verified bank universe. An unknown classification falls through as non-bank. [C3]

Provider documentation distinguishes `Bank`, `Securities`, `Insurance`, and `Regular` taxonomies and allows `com_type` overrides because automatic identification can be wrong. The documented finance source sample uses TCB for banks; it is not a complete eligibility list or a coverage promise. [P2][P3]

**Research eligibility constraints for a future bank playbook:** the anchor and preselected peers must be verified as the intended bank reporting entities, not merely financial-sector issuers, insurers, securities firms, or bank-affiliated holding companies. Establish whether each observation belongs to the listed bank, its accounting consolidated group, or its regulatory consolidation scope. Select the shared latest common fiscal year only after checking those bases across the whole fixed peer set. Do not choose each bank's independent latest period, substitute TTM for FY, or silently remove a peer lacking an eligible observation. These are comparability constraints, not a choice of columns.

A banking label cannot decide the consolidation perimeter. The official description of Circular 14/2025 expressly distinguishes solo and consolidated capital ratios and excludes an insurance subsidiary from regulatory consolidation under the described rule. An accounting consolidated balance sheet therefore cannot automatically be the capital-ratio denominator. [R1][R2]

## 2. Code and provider lineage

| Layer | Established evidence | What it does not establish |
|---|---|---|
| Statement transformation | Bank aliases map `net_interest_income` into generic `revenue`, bank-attributable profit into `net_income`, `operating_profit_before_provision` into `operating_income`; customer loans can become `accounts_receivable`; customer deposit aliases have `customer_deposits`. Statement `raw_data` can retain additional transformed source keys. [C4] | A generic `revenue` value is not uniquely NII or gross interest income; generic receivables are not automatically verified gross customer loans. |
| Ratio provider model | `FinancialRatioData` declares the eight bank fields. The reviewed transform branches do not populate them from bank aliases. VCI/configured-source/KBS candidates are considered by the fetcher. [C5] | Declaration does not prove upstream field presence or live values. Current official sponsor documentation is not proof that the pinned adapter uses its latest semantic taxonomy. |
| SQL ingestion | `FinancialRatio` has general ratios, period fields, `raw_data`, source and timestamps, but no dedicated bank KPI columns. Ratio `raw_data` is `ratio.model_dump(mode="json")`, with selected derived enrichment—not a verbatim original vendor response. Statement ingestion prefers `entry.raw_data` when it is a dict, otherwise the standardized model dump. [C6][C7] | “raw” does not mean original issuer filing, unmodified provider bytes, source revision or frozen observation. |
| Serving | `/equity/{symbol}/ratios` merges provider/Mongo/DB collections and calls `_enrich_missing_ratio_metrics`; statement-support rows can supplement the database. Bank calculations occur here. The separate `/ratios/history` path fetches provider ratios and is not the same bank-enrichment contract. [C1][C8] | A result for an old period can change on refresh; a common year is not automatically a common source/basis/version. |
| Display | Bank widget requests FY, formats loan/deposit as a multiple and the other bank KPIs as percentages; it describes rows as “Annual reported ratios”. [C9] | That wording is not evidence of reported status: the served bank KPIs can be VNIBB-derived. No UI was run in this research. |
| VniAgent | Grounded ratio context explicitly lists general ratios including P/B and ROE but not the eight bank KPIs. [C10] | Existing context does not give VniAgent the same bank observations as the enriched endpoint. |
| External MCP | MCP exposes financial-ratio collections, latest ratios, snapshots and allowlisted premium finance datasets, but does not establish the enriched bank endpoint's per-metric contract. [C11] | An accessible raw dataset or SQL row is not a citation-ready bank observation with formula, regulatory basis and revision. Both VniAgent and external MCP still require the same exact observation semantics for a later Matrix playbook. |

Provider documentation, read as documentation rather than a live probe:

- Community v4.0.6 documents yearly/quarterly statements, report/time-series orientation, `item`, `item_en`, `unit` and period columns; ratios include `priceToBook`, `roe`, `roa`. [P1]
- Sponsor `vnstock_data` v3.2.9 documentation describes VCI as the Unified Fundamental default, semantic IDs from v3.2.8, bank taxonomy override, `id/name/unit/order/level`, and alternative formats. It says financial reports use consolidated content **if available**, default currency VND unless otherwise specified, and audited/reviewed data can replace earlier self-published data. Those qualifications are important; they do not establish the status of any particular VNIBB row. [P2]
- The Finance adapter documentation lists VCI/MAS/KBS and sample-dependent differences. For its TCB sample, the document lists 86 VCI balance-sheet items, 26 income items, 58 ratios and 219 notes. These are **provider-documented sample counts**, not observed coverage or named NPL/CAR fields. Notes are documented only for VCI. A `capital_adequacy` filing category is documented elsewhere, but refers to documents, not a structured CAR observation; PDF acquisition is excluded. [P2][P3]
- The linked exact schema page in the provider guide was not retrievable (404). No semantic ID for NII/NPL/CAR is invented from this documentation.

## 3. Candidate dimensions and exact current semantics

The following formulas describe **existing VNIBB code**, not proposed regulatory formulas. Amount units must come from the selected source observations; ratios cancel units only when input scales match. The API does not attach a per-value unit/provenance object. [C1][C2]

| Candidate topic | Actual fields/aliases and computation | Research availability/comparability judgment |
|---|---|---|
| NII | Income raw-key lookup `net_interest_income`; statement map also aliases it to generic `revenue`. [C1][C4] | Conditionally recoverable amount. A displayed generic revenue value cannot establish which alias won. Preserve original key, label, amount unit, period flow and scope before calling it NII. |
| NIM | `nim = net_interest_income / earning_assets * 100`. `earning_assets` sums available gross loans, placements/loans to credit institutions and investment securities; averages current/prior positive sums, otherwise uses current positive sum alone. [C2] | Derived percentage, not a verified provider/issuer reported NIM. Missing components can be silently omitted. Averaging only two balances and falling back to one changes the basis. Block as “reported NIM”; a separately described approximation is a human playbook option, not approval here. |
| Asset yield | `asset_yield = revenue / earning_assets * 100`. [C2] | Same denominator gaps; additionally generic revenue can mean NII, interest-and-similar income or total operating revenue in the mapping. Do not equate this with interest-earning-asset yield without numerator provenance. |
| Customer loans | `loans_and_advances_to_customers`, `loans_advances_and_finance_leases_to_customers`, `gross_loans`; fallback to generic receivables. [C1] | Conditional balance-sheet amount. Gross/net, finance leases, allowance treatment and source scale need verification; generic receivable fallback is not proof of bank gross loans. |
| Customer deposits / simple loan-deposit ratio | Deposit aliases `customer_deposits`, `deposits_from_customers`, `tien_gui_cua_khach_hang`; `loan_to_deposit = gross_loans / customer_deposits` (multiple, not percentage). [C1][C2] | Potential accounting funding comparison if identities/bases match. It is not SBV Article 20 LDR: official rules have specific deposits/exclusions and time-dependent Treasury treatment. [R3] |
| CASA | Numerator aliases `current_account_deposits`, `current_accounts`, `demand_deposits`, `non_term_deposits`, `casa`; divided by customer deposits times 100. [C1][C2] | A label/alias does not establish that the returned value is an amount rather than an already-computed ratio, nor that the numerator includes exactly the issuer's CASA population. Conditional, definition validation required. |
| Deposit growth | Current less prior customer deposits, divided by prior, times 100. Prior key is `(year - 1, same quarter)` for quarterly mode and `(year - 1, 0)` for annual mode. [C1] | YoY-keyed comparison, not QoQ. FY common-year use still needs the prior FY observation; no current-only substitute yields valid growth. |
| Credit cost | `abs(provision_for_credit_losses or credit_loss_provision) / average_gross_loans * 100`; average uses current/prior gross loans, with current-only fallback. [C1][C2] | Conditional derived proxy, not validated issuer credit cost. `abs` discards provision/reversal sign, and missing predecessor changes the denominator. General/specific provision scope and expense versus allowance stock remain essential. |
| NPL and NPL coverage | No dedicated NPL/grouped-debt mapping or NPL denominator was established in the reviewed normalized paths. `loan_loss_reserve` aliases include `provisions_for_losses_on_loans_advances_and_finance_leases_to_customers`, `less_provision_for_losses_on_loans_and_advances_to_customers`, `provision_for_loan_losses`, `loan_loss_reserve`. Current `provision_coverage = abs(loan_loss_reserve) / gross_loans * 100`. [C1][C2] | **Blocked as NPL ratio or NPL coverage.** Existing field is allowance/gross-loans arithmetic. Cannot recover NPL balances, classification groups, off-balance-sheet treatment or reporting regime by relabelling it. Provider notes are a possible evidence route, not proven available fields. [P3][R4][R5] |
| Accounting capital | `equity_to_assets = total_equity / total_assets * 100`. [C2] | Conditional accounting leverage measure, feasible in principle; never CAR/CET1/Tier 1. Equity scope and negative/zero equity need explicit treatment. |
| Regulatory capital adequacy | No structured CAR/CET1/Tier 1, eligible regulatory capital, credit RWA or operational/market capital requirement mapping established in reviewed bank paths. | **Blocked.** Requires applicable circular/version, method, solo/consolidated perimeter, buffers, observation date and reported inputs or reported ratio. Ordinary equity/assets cannot substitute. [R1][R2][B1][B2] |
| Broader funding/liquidity | Loan/deposit, CASA and deposit growth exist as above; earning-assets helper accepts bank placements. No structured maturity ladder, HQLA/stressed outflow or stable-funding weighting mapping established here. | Do not infer liquidity resilience, SBV short-term-funding limit, Basel LCR or NSFR from deposit growth or accounting LDR. Basel LCR is its own framework with qualifying liquid assets and stressed subsequent-30-day flows. [B3] |
| ROE | Provider/SQL/AI paths carry `roe`; missing API value can be filled with `net_income / total_equity * 100` (period-end equity). [C1][C5][C6][C10] | Conditional earnings comparison. A supplied provider ROE and VNIBB fallback ROE do not automatically share attributable-profit, average-equity, annualization or consolidation definitions. Nonpositive equity is not a normal ranking denominator. |
| P/B | Provider `pb`/SQL `pb_ratio`, book-value/share and price/market-cap support/fallback paths. [C1][C5][C7] | Conditional valuation comparison, requiring explicit price date plus book-value period/scope/share basis. Fiscal-year tag alone does not fix the price date or prove contemporaneous historical shares. Zero/negative book equity needs a non-comparable state, not an ordinary cheapness rank. |

For bank KPIs the guards commonly require **both numerator and denominator** to be nonzero/non-null, so genuine zero values can fail to produce a value. Negative values are not universally rejected. N/A can therefore mean unavailable input, zero input, unsupported-for-bank suppression or failed derivation; it is not a sufficiently specific research observation state. [C2][C3]

## 4. Regulatory basis must travel with the observation

These are official-source findings, not a legal opinion or an exhaustive current-law consolidation:

1. **Capital vintages differ.** The government's official Circular 14/2025 notice (effective 15 September 2025) distinguishes core Tier 1, Tier 1 and total capital, solo/consolidated application, buffers and regulatory perimeter. It describes separate minimum ratios and phased capital-conservation buffers. Do not apply a single threshold without bank-specific applicable regime and adoption evidence. The 2023 official description of Circular 26/2022 also explicitly discusses banks not yet applying Circular 41/2016 continuing under Circular 22/2019 during their approved roadmap. Thus even a common date does not prove a common capital regime. [R1][R2][R3]
2. **Funding definitions change with time.** The official Circular 26/2022 summary says Article 20 deposit treatment excludes deposits such as customer margin/special-purpose deposits and specifies changing exclusions for term State Treasury deposits: 50% through 2023, 60% in 2024, 80% in 2025, 100% from 2026. This is evidence that a bare customer-deposits denominator cannot be assumed equivalent to regulatory LDR, not a claim that no later amendments exist. [R3]
3. **Debt classification is not just a ratio label.** Circular 31/2024 governs classification of assets/debts of commercial banks, non-bank credit institutions and foreign bank branches. The official summary describes monthly classification, off-balance-sheet commitments and CIC-driven alignment to the customer's highest-risk group. An SBV response published in September 2026 says classification probation must include restructuring time and refers to the circular as amended. The exact current NPL group scope, denominator, exceptions and transition history remain unverified in this no-PDF research; no formula or timeless threshold is invented. [R4][R5][R6]
4. **Basel is not interchangeable with SBV or accounting data.** BCBS describes Basel III as international minimum standards implemented in jurisdictions. Its capital framework distinguishes eligible instruments/adjustments; DIS30 explicitly reconciles accounting and regulatory consolidation/exposure amounts. Those documents clarify why ordinary accounting equity is insufficient; they do not establish that any named Vietnamese bank uses a particular Basel method/version in a given year. [B1][B2]

## 5. Preservation and gaps that affect a common-year Matrix

- **Period:** model fiscal year/quarter and normalized period strings survive, but a quarter missing supporting statements can fall back to annual lookup. Bank predecessor lookups use the prior year. A later Matrix FY path must not inherit quarterly/TTM fallback as proof of a common fiscal-year observation. [C1][C8]
- **Units:** original amount currency/scale and ratio percentage-versus-multiple are not a per-field contract. Statement normalization has an outlier heuristic that can divide selected scale fields (including customer deposits) by 1,000. Record an actual unit and transformation, not simply assume all values are VND. [C12]
- **Consolidation and authority:** no reviewed per-bank-metric object preserves issuer filing identity, issuer/auditor authority, accounting versus prudential scope, circular/version or bank adoption date. “Consolidated if available” in upstream docs is not a per-row guarantee. [P2][C1][C6]
- **Source identity:** SQL ratio ingestion uses `source='vnstock'` and serialized normalized fields; it does not freeze field-level VCI/KBS attribution, winning alias, competing values and formula inputs. The raw/premium route may retain additional source material, but a raw source document is not already linked to each enriched number. [C7][C8][C11]
- **Revisions:** upstream docs explicitly allow revised reviewed/audited data to replace earlier values. SQL conflict updates and runtime enrichment are not an immutable revision history. Retrieval/update timestamps are not issuer publication dates, audit dates or observation-version IDs. [P2][C6][C7]
- **Denominators:** distinguish missing, true zero, nonpositive/non-comparable and complete versus partial averages. For coverage, separate allowance stock, provision expense and NPL stock. No automatic sign repair or missing-component summing should be treated as verified semantics. [C2]
- **Rights:** API access, subscription/sponsorship and public documentation do not establish permission to retain original payloads, redistribute them through external MCP, expose them in AI context, or export snapshots. Per-provider rights for those uses remain unverified.

## 6. Alternative later-stage playbook candidates (research only)

| Candidate direction | Feasible evidence route | Blocker before exact comparison |
|---|---|---|
| Accounting funding and balance-sheet structure | Matched FY customer loans/deposits/equity/assets; explicitly defined simple ratios | Verified bank identity, exact raw keys, same unit/perimeter and full lineage; do not label regulatory LDR/CAR |
| Bank earnings and book valuation | NII amount, attributable earnings/book equity, provider or explicitly calculated ROE, dated P/B | Numerator provenance, ratio definition parity, annualization, equity/share basis and valuation date |
| Interest margin and provisioning | Explicitly versioned derived NIM/credit-cost proxies or separately reported observations if established | Complete earning-asset/loan denominator history, sign handling and reported-versus-derived separation |
| Asset quality and prudential resilience | Future structured reported NPL/coverage/capital/liquidity observations | Named provider fields plus definitions, legal vintage/adoption, regulatory perimeter and issuer/source revision; current `provision_coverage`/`equity_to_assets` do not satisfy this |

This resolves the research question with conditional feasibility and explicit blockers. It does not select columns, rank peers, infer issuer audit authority, expand the first implementation, approve PDFs, or assert that the live feed is populated. The same frozen observation and explanation must ultimately be available to both VniAgent and external MCP; neither current surface establishes that contract.

## Sources and evidence boundaries

All repository links below are pinned to the recorded base. Static documentation and code were read; the remote note and issue state are verified on publication. No application runtime or provider coverage was tested (prohibited by research scope).

### Pinned VNIBB source

[C1]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/api/v1/equity.py#L3466-L4488
[C2]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/api/v1/equity.py#L4322-L4377
[C3]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/api/v1/equity.py#L799-L906
[C4]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/providers/vnstock/financials.py#L650-L895
[C5]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/providers/vnstock/financial_ratios.py#L119-L737
[C6]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/models/trading.py#L217-L289
[C7]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/services/data_pipeline.py#L2832-L4088
[C8]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/api/v1/equity.py#L6657-L6865
[C9]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/web/src/components/widgets/BankMetricsWidget.tsx#L24-L205
[C10]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/services/ai_context_service.py#L1009-L1046
[C11]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/mcp/server.py
[C12]: https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/api/v1/equity.py#L699-L771

- [C1: enrichment, aliases and periods][C1]; [C2: bank formulas][C2]; [C3: classification/suppression][C3].
- [C4: statement mapping][C4]; [C5: ratio model/transform][C5]; [C6: SQL ratio schema][C6]; [C7: ingestion][C7].
- [C8: serving paths][C8]; [C9: bank widget][C9]; [C10: VniAgent ratio context][C10]; [C11: MCP tools/dataset allowlist][C11]; [C12: scale normalization][C12].

### Official provider documentation

[P1]: https://vnstocks.com/docs/vnstock/phan-tich-co-ban-fundamental
[P2]: https://vnstocks.com/docs/vnstock-data/fundamental-layer-v3
[P3]: https://vnstocks.com/docs/vnstock-data/bao-cao-tai-chinh

- [P1: Community Fundamental documentation][P1], shown as v4.0.6 when read.
- [P2: Sponsor Fundamental documentation][P2], shown as vnstock_data v3.2.9, including revision/consolidation/unit qualifications.
- [P3: Finance adapter documentation][P3], VCI/MAS/KBS schema and sector sample counts. Provider documentation is mutable; these are research-date observations, not frozen vendor releases or live issuer results.

### Vietnamese official regulatory publications

[R1]: https://vanban.chinhphu.vn/?pageid=27160&docid=214640&classid=1&typegroupid=6
[R2]: https://baochinhphu.vn/ty-le-an-toan-von-voi-ngan-hang-thuong-mai-chi-nhanh-ngan-hang-nuoc-ngoai-102250718105551891.htm
[R3]: https://baochinhphu.vn/sua-quy-dinh-ty-le-bao-dam-an-toan-trong-hoat-dong-cua-ngan-hang-102230201100326706.htm
[R4]: https://vanban.chinhphu.vn/?pageid=27160&docid=210625
[R5]: https://baochinhphu.vn/thoi-diem-trinh-tu-phan-loai-no-cua-ngan-hang-thuong-mai-102240715162220808.htm
[R6]: https://baochinhphu.vn/thoi-gian-thu-thach-phan-loai-no-tinh-the-nao-102260915103032518.htm

- [R1: official metadata for SBV Circular 14/2025][R1]; [R2: official Government publication explaining the circular, 2025-07-18][R2].
- [R3: official Government publication on SBV Circular 26/2022 amending 22/2019, 2023-02-01][R3].
- [R4: official metadata for SBV Circular 31/2024][R4]; [R5: official Government publication on its classification rules, 2024-07-15][R5]; [R6: SBV's direct response reproduced on the official Government portal, 2026-09-17][R6].

Full legal attachments were not acquired. R1/R4 establish document identity; substantive claims above are limited to the explicitly cited official HTML publications, not a claimed examination of every operative article/amendment. SBV static reads/search were access-blocked and the national legal search did not return usable results; official Government HTML supplied the cited evidence instead. Current bank-specific transition/adoption details and exact NPL definitions remain gaps.

### Basel Committee primary documentation (not a substitute for SBV rules)

[B1]: https://www.bis.org/committees/bcbs/standards
[B2]: https://www.bis.org/committees/bcbs/basel-framework/standard/dis/30/inforce/2019-12-15/published/2019-12-15
[B3]: https://www.bis.org/committees/bcbs/basel-framework/standard/lcr

- [B1: Basel standards and implementation][B1].
- [B2: DIS30, links between financial statements and regulatory exposures, effective/published 2019-12-15][B2].
- [B3: Liquidity Coverage Ratio framework][B3]. HTML only; no linked PDFs retrieved.
