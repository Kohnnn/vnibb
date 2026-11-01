# vnstock Library - VNIBB Reference Notes

> **Official documentation (stable/public)**: [vnstocks.com/docs](https://vnstocks.com/docs)
> **Official version history**: [vnstocks.com/docs/tai-lieu/lich-su-phien-ban](https://vnstocks.com/docs/tai-lieu/lich-su-phien-ban)
> **Upstream repo**: [github.com/thinh-vu/vnstock](https://github.com/thinh-vu/vnstock)
> **MCP/CLI companion**: [github.com/mrgoonie/vnstock-agent](https://github.com/mrgoonie/vnstock-agent)
> **VNIBB runtime target**: `vnstock` 5.2.1; explicitly sourced VCI for supported Vietnamese equity routes

This document is a VNIBB-facing reference, not the canonical upstream manual. It is audited against the public docs site, the official version history, the upstream GitHub README/CHANGELOG, and the `vnstock-agent` README.

The [official distribution index](https://vnstocks.com/api/packages/vnstock/) establishes published versions. VNIBB configuration and its dependency constraints define the runtime deployed here; upstream route availability does not itself establish VNIBB support or data admission.

Context7 is still useful for deeper API lookup, but it should be treated as a supporting source rather than the primary source of truth.

VNIBB uses Vietcap IQ as its primary Vietnamese ingestion source and explicit
`source="VCI"` for supported supplementary routes. Free runtime rejects separate
sponsor packages; Golden permits but does not use them. Other VNStock sources
are not execution fallbacks. Generation 5 combines the core into `vnstock` and
exposes `Fundamental`, `Market` and `Reference`; `Vnstock().stock()` is removed.
See the [official 4.x migration guide](https://vnstocks.com/docs/vnstock/chuyen-doi/tu-vnstock-4x).

## Generation-5 VCI financial interoperability (#183)

On 30 October 2026 an isolated SDK 5.2.1 review resolved income, balance,
cash-flow, OHLCV and reference-list routes to `vci` without source queries. This
route inspection is not evidence of live coverage or authorization.

The existing `VnstockFinancialsFetcher.transform_data` now accepts documented VCI
VAS `long` rows: `period`, `id`, `name`, `order`, `level`, `unit`, `value`, plus
`off_balance` for balance sheets. It groups complete periods before applying the
requested period limit, maps supported documented IDs for all three statement
families and retains original rows, attributes and taxonomy version. Per-item
`VNĐ` values are already VND, not billions. Unknown IDs stay raw and unserved;
unknown units, off-balance metrics, conflicting identity or duplicate values and
unverified reporting basis cannot become admitted numbers. Consolidation scope
and annual/quarterly flow basis are not inferred from a period or subscription.
The existing `admit_statement_rows` gate remains authoritative. Schema and taxonomy references:
[Fundamental](https://vnstocks.com/docs/vnstock/co-ban-fundamental),
[VAS analysis](https://vnstocks.com/blog/phan-tich-bao-cao-tai-chinh-tu-cau-truc-du-lieu-vnstock).

The 5.x statement adapter explicitly requests VCI `long` income, balance and
cash-flow frames via `Fundamental().equity(symbol)`. Registration was previously
exercised offline with synthetic authentication, not supplier credentials.
Cancellation does not block the startup deadline while an in-flight registration
worker completes.

Provider-free verification on 30 October 2026 used a disposable PostgreSQL 17
instance and synthetic VAS frames. Real extraction, `DataPipeline.sync_financials`,
SQL read-back and the HTTP reader preserved three finite values and returned
nine non-finite values as null with `missing_value`, across all three statements.
All 12 HTTP responses succeeded; the strict JSON serializer rejected direct NaN
and infinity inputs. No supplier or production database was contacted.

Golden includes Pipeline; Quant is available from Bronze. Neither is needed for
this reader, and no second scheduler, storage path or ratio engine is installed.
Software entitlement does not establish source-owner permission to acquire,
persist or publicly redistribute data. The published policy pages are marked
effective 30 November 2026, so retain the account's actually accepted terms rather
than assuming those future terms apply. #168 still requires source-owner/license
permission and an explicit coverage/finality contract. Acquisition, production
writes, scheduler enablement and redeployment remain gated. See
[entitlements](https://vnstocks.com/docs/goi-quyen-su-dung/gioi-thieu) and
[licence](https://vnstocks.com/policies/license).

### Agent Skills Hub

The isolated generation-5 environment includes the official skills loader; the
hub skills are fetched on demand and cached in process memory, not installed as
separate packages or copied into the repository. On 30 October 2026, all 16
skills available through Golden loaded successfully; `risk-manager` requires
Diamond. Load the catalog and a task-specific skill with the review environment's
Python interpreter:

```python
from vnstock.utils.agents import load_skill, load_skill_catalog

catalog = load_skill_catalog()
guidance = load_skill("pipeline-cli")
```

The loader uses the account already configured on the machine. The isolated
review interpreter is separate from the application environment. Never put keys
in source, logs or chat. The local `vnstock-env-setup`,
`vnstock-migration-expert` and `vnstock-solution-architect` skills describe
previous generations; follow generation-5 guidance. See the [Agent Skills Hub](https://vnstocks.com/agent-skills-hub)
and [official loader guide](https://vnstocks.com/docs/tai-lieu/vnstock-agent-skills).

### Local financial inventory

A provider-free, read-only transaction against the local PostgreSQL store on
30 October 2026 covered FPT, VCI, VNM and MSR for 2025 and Q1–Q3 2026. Of 48
selected symbol/period/statement cells, 12 had a row and 36 did not. The 12 rows
came from Vietcap; 24 non-null income fields were withheld because currency or
unit evidence was unverified. No inspected floating-point financial fields were
admitted in this selected scope.
This is a local snapshot, not production coverage or proof of source rights.
The [bounded inventory instructions](../scripts/vietcap/README.md#bounded-sql-statement-admission-inventory)
require a read-only database account and do not call a provider.

SDK migration does not itself authorize acquisition, publication, production
writes, scheduler enablement or deployment. Preserve the admission gates and
the source-owner/license and coverage prerequisites in #168.

---

## Installation and SDK interfaces

From the repository root, install the API with the publisher-wheel constraints:

```bash
python -m pip install --isolated --index-url https://pypi.org/simple -c apps/api/constraints-vnstock.txt -e "apps/api[dev]"
```

The [publisher's 5.2.1 index](https://vnstocks.com/api/packages/vnstock/) lists
CPython 3.10+ ABI3 wheels for glibc Linux x86-64/aarch64, macOS x86-64/arm64
and Windows amd64; musl, Windows ARM64, 32-bit and PyPy wheels are not listed.
The SDK metadata requires pandas 2.0+ and Windows `tzdata`; it does not declare
the legacy `vnai` dependency. Unsupported platforms need a publisher-supported
artifact, not a silent fallback to the 4.x package.

### Registration and Golden configuration

Both `VNSTOCK_RUNTIME_TIER=free` (default) and `VNSTOCK_RUNTIME_TIER=golden`
use the unified SDK and require `VNSTOCK_SOURCE=VCI`. Golden requires
`VNSTOCK_API_KEY`, supplied through the deployment's secret mechanism, never
source control or logs. Startup calls `vnstock.setup_api_key` and requires an
authenticated `golden` or `diamond` result. Missing key, timeout, registration
lock contention, authentication failure or insufficient tier aborts Golden
startup without disclosing the key. SDK login verifies remotely and persists
the credential locally; account for that storage in the deployment environment.
Golden does not automatically raise VNIBB's guest-paced defaults. Entitlement
does not override VCI source and financial-data admission or establish rights.

Free mode performs no startup account or registration check and does not log
out or delete persisted SDK credentials. Use an isolated `VNSTOCK_HOME` for CLI
and scripts so a persisted paid account cannot be reused accidentally. Free
still rejects discoverable legacy sponsor packages before SDK import.

Generation 5 exposes the following SDK interfaces. Examples show the source
parameter explicitly; executing them contacts a supplier and requires the
appropriate authorization and applicable entitlement.

```python
from vnstock import Fundamental, Market, Reference

history = Market().equity("FPT").ohlcv(start="2026-01-01", end="2026-06-30", source="VCI")
profile = Reference().company("FPT").info(source="VCI")
income = Fundamental().equity("FPT").income_statement(period="year", format="long", source="VCI")
```

The SDK's source-computed ratio route is deprecated and its documented
entitlement requirements apply; neither a ratio response nor a Golden account
proves unit, fiscal-period or source admission. Never infer units or report basis
from numeric magnitude or entitlement. Stored lineage and the existing admission
rules determine what VNIBB can serve.

## Unsupported and independent routes

- Company news was removed in SDK 5; general ratings are absent. The historical
  aggregate trading-statistics contract is not equivalent to the SDK's current
  session statistics. VNIBB reports these as provider errors instead of inventing
  results. Company ownership explicitly requests VCI; an unsupported result does
  not switch to the SDK's KBS default.
- VCI company events remain the path for events, insider-event filtering and
  dividends where supported. A route's presence does not guarantee observations.
- The commodities endpoint retains its independent Yahoo path. Removed or absent
  VNStock gold helpers do not manufacture gold prices when Yahoo returns no rows.
  Forex uses the independent Vietcombank `Retail().exchange_rate()` route, not VCI.
- The built-in historical OSS screener is not a VNIBB source. Use the existing
  database-backed screener, subject to its own freshness and admission rules.

## Rate limits and authorization

VNIBB's configured defaults pace 18 main and 2 reinforcement calls per minute,
with a 20/minute per-operation ceiling. These local controls are not a shared
cross-process quota ledger, a supplier availability guarantee, or permission to
collect data. Follow the account's applicable terms and source-owner permissions;
do not turn on acquisition or schedules merely because the SDK can be imported.

## Retained ingestion contracts (2026-10-13)

- IQ is primary; only explicitly sourced VCI may supplement it. Fiscal identity must reconcile every supplied year, quarter, and period before a SQL natural key is assigned.
- The shared `financial_fiscal_basis` validator requires the exact dataset variant and checks any supplied `periodType` (trimmed, case-insensitive) against `year`/`quarter`, alongside year/quarter/period identity. An explicit annual `RATIO_YEAR` stays annual even when a secondary opaque `ratioTTMId` is also populated, and `2018`/`"2018"` reconcile identically. The canonical outer period is FY-only: an annual `RATIO_YEAR` may carry the provider quarter alias `5`, while a stored outer period label of the form `YYYY-Q5` matching that explicit annual year is unusable, so that row keeps its valid raw identity and is excluded and disclosed (`legacy_period_labels`) under stripped-period validation instead of being numerically repaired or relabelled. This disclosure is scoped to that explicit-`RATIO_YEAR` mismatch, not a general licence to strip period labels. TTM is never a standalone quarter or fiscal year; `reason` is exactly `None`, `contradictory`, `ratio_ttm` or `unavailable`, distinct from reader-side unsupported-metadata reasons, and the corrected TTM envelope is produced by the writer (`FinancialRepair`) rather than reconstructed at read time. Observation/ingestion timestamps never manufacture a fiscal year, and missing legacy identity is not proof of an annual or quarterly period.
- Canonical quarter monetary flows require explicit `single_quarter` reporting evidence. Missing/conflicting basis and cumulative YTD values remain disclosed in raw envelopes but are not relabeled as quarter flows. Consolidation remains unknown unless the response explicitly identifies it; descriptor section/company type does not establish scope. Explicit EPS `VND/share` can remain available independently of unknown scope. Amount scales cannot manufacture per-share units.
- IQ SQL statements retain full acquired envelopes plus the existing `_financial_lineage.canonical_data` shape, including explicit unit/flow/scope evidence. Secondary ratio refreshes cannot overwrite or enrich IQ-owned rows; the shared source guard reports conflicting natural keys and retains already persisted counts. Fresh certified IQ stock prices may upgrade generic IQ-owned price rows, never another source's rows.
- IQ `finance.ratio` SQL rows retain the full acquired envelope and `structured.fieldEvidence`; `raw_data.ratio_units` copies canonical units only for decoder-admitted `structured.values` fields. Explicit `percent` or `%` is stored as `percent` without rescaling: ROE `0.25` remains `0.25`, and `25` remains `25`. Missing, unknown, or conflicting units withhold the canonical metric while preserving its raw value and evidence. MCP reads this same persisted unit map; it never infers scale from source or magnitude. Earlier IQ SQL rows with structured evidence but no unit map are repaired through the existing financial reingestion workflow, not direct SQL relabeling.
- From the `vnibb` root, use `PYTHONPATH=apps/api python apps/api/scripts/vietcap/backfill_vietcap.py --symbols VNM --limit 1 --datasets ratios` for a bounded dry-run; apply the approved refresh with the same command plus `--apply --ensure-indexes`. This reacquires descriptors and values before the normal decoder/SQL upsert; it does not manufacture unit evidence from historical numeric columns.
- `sync_symbol_financials` continues independent datasets after an acquisition failure. `FinancialAcquisitionPartial` exposes acquired `records`, dataset `errors`, and completed `mongo_rows`; CLI and recurring consumers persist reachable structured groups and report incomplete acquisition rather than raw-only success. Structured persistence errors retain their own affected-row counts.
- The recurring EOD SQL bridge accepts only confirmed `STOCK` listings. Valid index-point bars remain Mongo observations and do not enter the stock/VND bridge.

