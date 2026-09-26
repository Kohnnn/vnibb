# Matrix insurer evidence: availability and comparability

Research resolution for [#52](https://github.com/Kohnnn/vnibb/issues/52), supporting [Matrix map #35](https://github.com/Kohnnn/vnibb/issues/35). Researched 2026-09-26.

- Isolated branch: `research/matrix-insurer-evidence`.
- Claimed base, before research: `20fa4c392e22a42b2d150de22989bb2331a98adb` ([claim](https://github.com/Kohnnn/vnibb/issues/52#issuecomment-5844903692)); the remote branch head was also checked at that base before this note was committed.
- Scope: specification evidence for a **later, separate insurer playbook**, not the first non-financial implementation. The anchor plus preselected peers and shared latest common fiscal year remain the comparison contract. These are candidate families, not approved columns or peer selections.
- Method: pinned repository code, official provider documentation, Vietnamese government legal metadata and issuer HTML. No production database, market/provider/AI calls, PDFs, corpus acquisition, application edits or tests. Documentation means a field/method is described; code means a path can carry it; neither proves populated live coverage.

## Resolution

VNIBB can represent generic financial statements, ratios and raw provider records, but the verified standardized statement model does **not** establish premiums, underwriting profit, loss/expense/combined ratios or regulatory solvency as typed insurer observations. A generic `insurance` sector is not a life/non-life/reinsurance eligibility decision. Current AI summaries and external MCP raw datasets are useful transport seams, not frozen, per-metric issuer/audit evidence.

The safe later-stage alternatives are: (a) an accounting-only comparison explicitly labelled as such; (b) a non-life underwriting comparison once exact earned-premium/claims/expense observations are demonstrated; (c) a separate reinsurer comparison with assumed/retroceded business and retention basis; (d) a life comparison with its own premium, benefit/reserve, capital and investment definitions. None is selected here. Treat a mixed financial holding group as mixed until segment/legal-entity evidence establishes comparability.

## 1. What the current code actually carries

All code links below pin the base above. Findings are restricted to the cited, verified files; they are not a claim that every possible provider field has been exhaustively enumerated.

| Layer | Verified capability | Insurer limitation |
|---|---|---|
| Classification | [`VN_SECTORS['insurance']`](https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/core/vn_sectors.py) uses `8500`, `8530`, `8570`, `bảo hiểm`/`insurance`; both `bao hiem` and `bao hiem phi nhan tho` map to it. | One bucket; no separate eligibility record identifying life, non-life, assumed reinsurance, mixed holding company or licensed risk carrier. Do not reinterpret these configured codes as verified issuer licences. |
| Normalized statements | [`FinancialStatementData` and `_metric_mapping`](https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/providers/vnstock/financials.py) expose revenue, gross/operating/net income, assets/liabilities/equity, OCF/investing/financing/FCF and optional `raw_data`. | No dedicated premium, claims incurred, insurance reserves, acquisition costs, combined ratio, available solvency capital or required solvency margin fields in this model. `financial_income` maps to generic `other_income`; generic SG&A is not demonstrated insurance acquisition/administration expense. |
| Provider selection and transformation | The same fetcher tries VCI, configured source and KBS, scores candidate payloads against generic statement fields, and can supplement selected fields from another source. Pivoted KBS monetary values are multiplied by 1,000 except EPS; row shapes and labels are normalized. | A normalized field is not necessarily a single original source observation. Pivot output does not populate `raw_data`/`updated_at` as the non-pivot path does. Do not infer original unit, provider or audit status solely from the displayed label or timestamp. |
| Vietcap raw statement store | [`upsert_statement_periods`](https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/scripts/vietcap/vietcap_writers.py) writes `finance.*` rows to `market_vnstock_premium_records`, retaining `raw`, `source`, `providerSource`, fiscal year/quarter, section and `recordKey`. | This is storage machinery, not an insurer field inventory. `_period_label` treats quarter codes 1–4 as quarters and everything else as annual; the comment identifies 5 as annual. Its `observedAt` is synthesized as January 1 of report year, **not publication or observation time**. |
| Metric dictionary | In that writer, `market_financial_metric_map` is keyed by `(comTypeCode, section, source='vietcap')`; `labels` are keyed by original `field`, carrying `name`, `level`, `parent`, `titleEn`, `titleVi`, `fullTitleEn`, `fullTitleVi`; `updatedAt` and `schemaVersion=1` are saved. | No exact insurance `field` codes or populated dictionaries were observed. The upsert replaces the dictionary, not an immutable dictionary revision. It does not demonstrate per-field unit/formula or regulatory definition. Inventing premium/solvency codes would be unsafe. |
| Shared Mongo reader | [`get_raw_dataset_records`](https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/services/mongo_market_data_service.py) accepts an optional `datasetVariant` filter and returns `raw`, `observedAt`, `updatedAt`, `dataset`. | Projection drops outer `recordKey`, provider source, section and schema version. This reader alone cannot reconstruct complete source provenance. Vietcap statement writer above does not set `datasetVariant`; a `finance.*.year` filter is therefore not evidence of universal annual coverage across source paths. |

`revenue`, `gross_profit`, `operating_income` and `operating_cash_flow` must not be renamed into premiums or underwriting performance. Different aliases collapse into the generic fields; the verified map even accepts bank and securities-business revenue labels. A populated generic value establishes neither economic equivalence nor an insurer denominator.

## 2. External provider documentation versus current integration

The official [Vnstock Community Fundamental documentation](https://vnstocks.com/docs/vnstock/phan-tich-co-ban-fundamental), displayed as v4.0.6, documents annual/quarterly statements, report/time-series orientation, `item`, `item_en`, `unit` and generic ratios. It does not document exact insurer-specific metric keys or guarantee every insurer/period has data.

The official [vnstock_data Fundamental documentation](https://vnstocks.com/docs/vnstock-data/fundamental-layer-v3), displayed as v3.2.9, is materially richer:

- VCI is the documented default source; `com_type` supports `Regular`, `Bank`, `Securities`, `Insurance`, with automatic detection and an override for misclassification.
- Since v3.2.8 the documented default long-form schema uses `id`, `name`, `unit`, `order`, `level`; wide/time-series pivot on `id`.
- `financial_health` selects a scorecard, joins reports by `period` and retains selected criteria. A scorecard is a normalized summary, not a proof of exact field provenance or a recommended Matrix column set.
- Documentation states consolidated reports are used where available, currency defaults to VND unless otherwise indicated, and audited/reviewed reports replace earlier issuer self-published data automatically.
- `note()` exists; its existence is not proof of premiums, reserve movements or solvency coverage. `filing()` is document-link acquisition and is excluded by the no-PDF scope.

These are provider-documentation facts, **not evidence that the pinned VNIBB runtime has adopted that latest schema**. Its verified financial fetcher still calls `Vnstock().stock(...).finance` and maps named fields. In particular, an `Insurance` taxonomy does not subdivide life/non-life/reinsurance eligibility. Exact taxonomy IDs, raw codes, field semantics and historical revision availability remain unverified. The documentation's relative detailed-schema link did not resolve during this research; no absent code was guessed.

## 3. Eligibility and candidate observation families

The following are analytical comparability constraints, marked **[INFERENCE]** where no exact local provider/regulatory formula was verified. They do not assert live values or approve columns.

### Entity and activity gate

- **Life:** compare like-for-like life legal entities or evidenced life segments, not every issuer labelled Insurance. Premium flows, benefits, surrender payments and changes in long-duration reserves are not interchangeable with non-life claims-cost performance. Life total premiums, new-business premiums, annual-premium-equivalent and investment-linked contributions are distinct concepts; none has a verified raw field here. **[INFERENCE: comparison constraint]**
- **Non-life:** establish that the numerator and denominator describe the same insurance business and retention basis, including any health component. Do not assume the entity writes only direct business. **[INFERENCE]**
- **Reinsurance:** separate assumed premiums from direct-written premiums and retrocession from ordinary cessions. The primary [VINARE AGM HTML disclosure](https://vinare.com.vn/2026/04/24/vinares-general-meeting-of-shareholders-strengthening-internal-strength-sustaining-long-term-growth/) explicitly identifies the entity as a reinsurer, distinguishes underwriting discipline from investment activity and discusses a combined-ratio target. That proves actual issuer usage of the concept, not its exact formula or VNIBB coverage.
- **Mixed groups:** the [Bảo Việt issuer website](https://www.baoviet.com.vn/vi) lists distinct life, non-life, bank, securities and fund-management businesses. Group accounts cannot be assumed to be a pure life or pure non-life observation. This is an issuer-scope example, not a peer recommendation or claim about any current Matrix row.

### Metric availability and basis checklist

| Candidate topic | Required meaning and basis | Present evidence / unresolved availability |
|---|---|---|
| Premiums | Direct/original, assumed, ceded/retroceded, gross versus net; written versus earned; returns/cancellations and unearned-premium reserve movements; flow over full FY; original currency/scale. | No insurer-specific typed mapping verified. Raw `finance.income_statement` and dictionary could carry components, but exact keys and completeness are unknown. Generic revenue must not substitute. |
| Underwriting result | Insurance income less consistently defined claims and underwriting expenses; clarify inclusion of reserve changes, reinsurance commissions/recoveries and other technical income. Exclude investment earnings only if the disclosed definition does. | No verified underwriting-result field/formula. Generic operating income or revenue minus generic cost of revenue does not establish it. |
| Claims / loss ratio | **[INFERENCE]** A conventional non-life candidate is incurred claims / earned premium, on consistent gross or net basis; incurred includes appropriate reserve movements, not merely cash paid. Paid-claims/written-premium ratios can be separately named observations but are not interchangeable. | Claims paid, incurred, outstanding reserve changes and reinsurance recoveries are unverified. No universal Vietnamese regulatory/provider loss-ratio formula was established. |
| Expense ratio | **[INFERENCE]** Insurance acquisition/commission and administration costs with explicit treatment of deferred acquisition costs and reinsurance commissions. Record whether denominator is written or earned premium. | Generic SG&A is served, but that does not establish the required expense perimeter or denominator. |
| Combined ratio | **[INFERENCE]** Applicable to comparable non-life underwriting and corresponding non-life reinsurance business once a disclosed formula is known. Often combines loss and expense ratios; components may use different conventional denominators, so do not silently rewrite it as one quotient. Not a blanket life or mixed-holding-company quality ratio. | VINARE's HTML demonstrates a **target**, not an actual achieved observation or formula. Exact gross/net, reserve, expense and denominator definitions were not supplied by that page. Do not average peer ratios or sum mismatched-basis components. |
| Solvency | Legal entity, regulator, applicable rule/version, measurement date, eligible/available capital or margin, required capital or margin, deductions and coverage ratio versus monetary surplus. | No typed regulatory observation or exact code verified. Equity/assets, debt/equity, current ratio, credit rating and profit are **not substitutes**. Current regulatory formula, transitional status and component availability remain gaps. |
| Investment income | Distinguish gross income, investment expenses/net result, realized/unrealized gains, interest/dividends and policyholder/shareholder or segment allocation. A yield requires a stated average invested-assets base and matching flow period. | VINARE distinguishes investment income in issuer HTML, but VNIBB maps `financial_income` to generic `other_income`. That normalized bucket cannot certify exact investment income or yield. |

For every ratio: missing, non-finite or zero denominator means no computable observation, not zero performance. A negative earned-premium adjustment or negative capital base needs explicit interpretation rather than ranking as an ordinary positive-base ratio. Monetary values must share units before arithmetic; percentage versus decimal must be explicit. Growth requires the preceding like-for-like period, a positive meaningful base and restatement alignment. These are **[INFERENCE: arithmetic/interpretation safeguards]**, not newly implemented behavior.

## 4. Regulatory vintage: verified boundary, not an invented solvency rule

The Vietnamese Government's [official record for Law 08/2022/QH15](https://vanban.chinhphu.vn/?pageid=27160&docid=206242) establishes its title, issue date 16 June 2022 and effective date 1 January 2023. Its HTML detail offers PDF attachments, which were not fetched. The [official record for Resolution 32/NQ-CP](https://vanban.chinhphu.vn/?pageid=27160&docid=217102) concerns continued effect of decrees implementing that law; this alone warns against treating the original law as a timeless calculation specification.

The [Ministry of Justice national legal database](https://vbpl.vn/) search for `08/2022/QH15` on the research date returned the law and Decree 46/2023/NĐ-CP marked partly expired, a 2026 consolidated law (31/VBHN-VPQH), and Decree 97/2026/NĐ-CP amending Decree 46. The search results are metadata, not verified operative article text. Detail navigation did not yield usable full HTML text; legacy URLs redirected to the index. Consequently this note does **not** assert current solvency thresholds, admissible-asset deductions or a complete amendment chain.

VINARE's AGM HTML says it is preparing for risk-based capital requirements expected from 1 January 2028. Attribute that timing to the issuer disclosure; it is **not independent verification of the applicable regulatory transition for every insurer**. A historical solvency-margin series and a later risk-based-capital ratio must not be spliced or peer-ranked without period-specific legal definitions. Verifying operative non-PDF legal text and each issuer's disclosed calculation is a prerequisite for claiming a regulatory solvency metric, not permission to backfill a generic balance-sheet proxy.

## 5. Shared fiscal year, observations and revision identity

The Matrix contract uses the shared latest common FY for the anchor and selected peers, not each issuer's latest row. Availability must be established for that actual intersection after entity, consolidation and definition checks. Annual flow, FY-end stock and period-average denominator are different temporal objects. A quarter/YTD/TTM value is not an annual substitute. No shared year or complete peer coverage was asserted here.

A defensible observation would retain: issuer/legal entity and segment; consolidation basis; original field code and label; provider/dataset/section and taxonomy revision; reporting start/end, fiscal year and flow/stock nature; original unit/scale and conversion; value/status; gross/net and written/earned basis; source URL or publication identity; original versus reviewed/audited/restated status; retrieval timestamp; immutable observation revision; and any derived formula with constituent observation identities. **[INFERENCE: evidence requirements, not an implemented schema]**

The current Vietcap writer uses a stable per-symbol/dataset/period key and `$set` upsert. It can replace old raw values without storing the old revision. `schemaVersion=1` is the writer schema, not an issuer restatement version. Its dictionary is likewise overwritten; the reader discards several outer identifiers. Provider documentation explicitly describes replacement by later audited/reviewed values. Therefore neither a mutable raw record nor a latest summary establishes an exact frozen historical observation, audit opinion or issuer-authoritative lineage.

## 6. VniAgent and external MCP

Both are required future consumers; neither can repair absent source definitions by inference.

- [`ai_context_service._build_symbol_snapshot`](https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/services/ai_context_service.py#L1001-L1081) supplies a Postgres financial summary with company industry/sector, period/type/year/quarter, generic ratios and statement metrics. Missing sections are null. The summary does not include an insurer premium/underwriting/solvency family or metric-level raw field/revision lineage. `source='postgres'` identifies storage, not an issuer or auditor.
- [`MCP get_premium_dataset`](https://github.com/Kohnnn/vnibb/blob/20fa4c392e22a42b2d150de22989bb2331a98adb/apps/api/vnibb/mcp/server.py#L1289-L1321) exposes the four finance datasets, bounded to 200 rows each by their specs. It returns dataset, scope, row count, items and `source='mongodb:market_vnstock_premium_records'`. It does not pass the optional variant filter, so annual and quarterly records may coexist; the shared reader projection still applies. MCP transport/source labelling does not establish the underlying metric's meaning, publication time or rights.

## 7. Rights, gaps and acceptance boundary

The [official Vnstock site](https://vnstocks.com/) states software requests go directly to third-party sources, availability and conditions depend on each source, and its software licence does not grant third-party data rights. It distinguishes personal/research use from commercial software permission; even a software agreement does not replace permission to use/distribute source data. No evidence here establishes VNIBB's permission for persistent metric snapshots, public redisplay/export, VniAgent model transmission or external MCP redistribution. Those rights remain separately unverified. Public issuer HTML and government metadata are citation evidence, not a blanket commercial data licence.

Resolved: what the verified normalized and raw paths can carry; why insurer subtype and source-basis gates matter; alternative later playbook families; why generic revenue/OCF cannot certify underwriting; and where exact provenance is lost.

Open evidence gaps, intentionally not hidden by zeros or proxy metrics:

1. Exact insurer raw codes/taxonomy IDs and per-period populated coverage, including premiums, claims, expenses, investment components and solvency.
2. Licensed subtype/segment eligibility and consolidated/separate basis for the actual anchor and peers.
3. Issuer/provider definitions for gross/net, earned/written, paid/incurred, acquisition costs and combined ratio.
4. Current and historical operative solvency rules, transitions and calculation components.
5. Immutable field-map/report revisions, publication/audit/restatement identity and full lineage through both consumers.
6. Source-specific software/data permissions for intended retention, display, AI use and MCP access.

The research ticket can close because these availability and comparability boundaries are established. Closing it does not approve columns, attest live coverage, remove the no-PDF constraint or authorize implementation of the later insurer playbook.
