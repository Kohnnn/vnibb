# Vietcap Backfill Scripts

Bounded public Vietcap IQ/trading ingestion into MongoDB `vnibb-market`. Vietcap is primary; explicitly sourced vnstock VCI is the only eligible supplementary VNStock source. VCI uses the same upstream and is not an independent outage fallback. Acquisition requires the applicable source-owner permission and coverage contract.

## Quick start

Run from `vnibb/apps/api`; default inventory is provider-free and writes nothing:

```bash
python scripts/vietcap/backfill_vietcap.py inventory --symbols VCB,BVH,FPT \
  --datasets financials,company,listing --universe-file /path/to/trading-universe.json
```

Apply the same bounded slice (requires `MONGODB_URL`):

```bash
python scripts/vietcap/backfill_vietcap.py backfill --symbols VCB,BVH,FPT --max-pairs 9 \
  --datasets financials,company,listing --apply
```

Rerunning the same slice upserts the existing natural keys. Apply also awaits descriptor-supported financial persistence through the existing cache/database bridge. Unsupported fields remain unavailable; raw data remains preserved. Neither command deletes, reconciles, rescales, or repairs existing data.

OHLC responses must identify the requested symbol before conversion. Apply persists only rows inside the inclusive `--start`/`--cutoff` window to Mongo and SQL; a response containing only outside-window rows records the existing empty outcome. `countBack` is not a completeness guarantee and no missing session is synthesized.

## Flags

| Flag | Meaning |
|---|---|
| `--symbols` | `ALL`, an instrument type, or comma-separated symbols |
| `--datasets` | `ohlc,financials,ratios,company,shareholders,listing,indices,icb` or `all`; unknown names are rejected |
| `--max-pairs` | Positive symbol/dataset attempt bound; never truncates the selected universe |
| `--count-back` | Positive OHLC history bound; default 10000 |
| `--apply` | Enable provider acquisition and upserts for backfill/resume; migration writes are provider-free |
| `--ensure-indexes` | Create supporting indexes during apply; metric-map index failures are fatal, requiring controlled cutover |
| `--checkpoint-file` | Durable receipts; resume skips only exact succeeded pairs |

`financials` includes all three statement sections plus raw ratios. `listing` (singular) joins selected trading instrument metadata with IQ search metadata under `reference.listings`. Without `--apply`, backfill/resume report retained receipts without provider calls or SQL admission. Apply preserves raw rows and returns status 1 when a requested structured group has no supported fields; reachable groups still persist. Any caught error or unavailable requested raw data also returns status 1. Invalid flags/datasets return status 2. All apply persistence shares one event loop; the database engine is disposed before that loop closes.

## Financial contract

- Runtime implementations live in `vnibb/services/vietcap_client.py` and `vnibb/services/vietcap_ingestion.py`; recurring ingestion and this CLI reuse them.
- Annual/quarter variants are `{dataset}.year` and `{dataset}.quarter`. Existing financial `recordKey` and dataset/symbol/key upsert filters remain unchanged.
- Company classification comes from the actual symbol's IQ `comTypeCode`, never its trading instrument type. Missing classification stays unknown.
- Descriptors are fetched once per symbol and retained as original section lists, including hierarchy, repeated fields, nulls and unknown properties. `market_financial_metric_map` uses `(symbol, comTypeCode, section, source)`, top-level `descriptors` and exact `descriptorEvidence`, `schemaVersion=3`. Every section, including `NOTE`, stays symbol-scoped. No growing `symbolDescriptors` write remains; legacy documents are retained unserved.
- `observedAt` and `receivedAt` are receipt timestamps, not fabricated fiscal publication dates. `rawFiscalBasis` retains supplied fiscal/basis fields; parsed `publicDate` is preserved as `sourceDate`.
- Statement and ratio values stay raw. Units are unknown unless actual payload/descriptor evidence establishes them. No magnitude-based scaling or guessed metric mapping is allowed.
- Structured fields require the symbol/section descriptor evidence consumed by `vietcap_financials`; unsupported units, labels or ambiguous fields remain unavailable.
- IQ application failures, including `successful=false`, raise even on HTTP 200. Required OHLC arrays must have equal lengths.
- OHLC acquisition admits a response only when its raw `symbol` is present and matches the requested symbol (case-insensitively). Missing or mismatched source identity is rejected before assigning the requested document symbol; the raw response stays unchanged.
- `sourceResponse` preserves the original IQ status/code/success/trace metadata; descriptor response metadata is retained separately in `descriptorEvidence.sourceResponse`.
- Statement/ratio envelopes retain `responseEvidence` (symbol, company type, section, source, endpoint and receipt time). Response-level unit/currency/scale and flow/consolidation declarations are consumed only when that exact scope and receipt match; contradictory declarations remain unavailable. The metrics endpoint spans multiple sections, so its response-level declarations additionally require an explicit matching `section`. Full responses and per-field evidence survive PostgreSQL/MCP lineage without mutating raw rows.
- Ratio writers retain supplied `RATIO` descriptors and their evidence, and recurring financial acquisition forwards that section only when IQ actually supplies it. The observed IQ metrics contract supplies statement sections plus `NOTE`, not ratio descriptors. The observed statistics-financial contract supplies raw field names but no unit/percent encoding. Those fields remain raw until authoritative mapping and units are available; no descriptors are synthesized from camel-case keys.
- Equity/ETF/warrant endpoint prices retain source-backed VND units; indices/futures retain points. Unsupported instrument units remain unknown and prevent numerical ingestion claims.
- Apply bridges confirmed stock OHLC to the existing PostgreSQL price store and reports `structured_price_rows`. Financial/source conflicts retain raw Mongo records, report partial committed counts and conflicting natural keys, and return nonzero rather than overwrite non-IQ SQL data.
- Listing upserts run before dependent stock prices. An applied stock OHLC slice also fetches and persists its bounded IQ/trading listing prerequisite when `listing` is not explicitly selected, so a first-run database can admit those prices.

An applied stock OHLC slice reports its admission outcome under `price_admission`: `source_rows`, `admitted_rows`, `rejected_rows`, `rejected_reasons` (for example `invalid_ohlc_bounds`, `missing_negative_or_nonfinite_ohlcv`, `noninteger_volume`, `invalid_date`), `persisted_rows` and the actual admitted/persisted first/last bounds, plus a `classification`. A mixed window is `partial_source_invalid` and the pair is still receipted `failed` behind a strict guard that requires the full returned window to reach SQL (`Returned OHLC window incomplete: <rejected> source rows unadmitted; <persisted>/<returned> SQL rows persisted`); a rejected SQL conflict instead classifies `sql_source_conflict` with `conflicting_keys` and also returns nonzero. A real new-process apply observed this end to end: AAA returned 4,049 source rows, persisted 4,048, and rejected exactly one `invalid_ohlc_bounds` row as `partial_source_invalid`. Rejections are source-invalid rows, not writer loss: every raw Mongo row is retained unrepaired, `history_complete` stays `null`, and re-running `resume` under the same contract retries the pair rather than silently certifying a short window.

## Controlled metric-map cutover

This is an additive storage migration, not a provider acquisition or financial-unit repair. Run the following only after the integration owner's source freeze and targeted checks, using the actual deployment interpreter/environment:

1. Pause owned recurring/backfill financial writers and request-time IQ acquisition (the daily scheduler and HTTP empty/unusable-financial path both reuse `sync_symbol_financials`). Record process identity and checkpoint; do not terminate unrelated processes. Back up Mongo data, PostgreSQL and receipts; record checksums and the actual `market_financial_metric_map.list_indexes()` specifications/cardinality before writes.
2. Inspect candidates without provider calls or writes:

   ```bash
   python scripts/vietcap/backfill_vietcap.py migrate-metric-maps
   ```

3. Apply while writers remain paused:

   ```bash
   python scripts/vietcap/backfill_vietcap.py migrate-metric-maps --apply
   ```

   The helper first creates `uq_metric_map_symbol_type_section_source`, unique `(symbol, comTypeCode, section, source)`, partial filter `symbol: {$type: "string"}`. It then drops only indexes whose actual reported keys equal the obsolete `(comTypeCode, section, source)` and whose `unique` flag is true. Index errors propagate; there is no mock/silent success. No documents are deleted. Originals without outer `symbol` remain unserved historical raw.

   Copies come only from exact `symbolDescriptors.<symbol>` entries with matching stored symbol/endpoint/receipt, or raw envelopes with fully matching symbol/type/section/source `descriptorEvidence`. Original descriptor lists, receipt dates and response metadata remain; `migrationSource` records the retained collection/document ID/path and legacy aggregate timestamps separately. Missing per-symbol created/update dates stay absent; aggregate dates are never assigned as symbol facts. Shared generic `labels`, unknown receipts and contradictory evidence are rejected, never guessed. `$setOnInsert` preserves existing bounded keys; reruns are additive/idempotent. `eligible`, `inserted`, `existing`, `rejected` and `dropped_indexes` are disclosed.

   `migrationSource.documentId` is stored as the original ID's string representation for the public JSON contract. Rerunning this same command inventories (`normalizable_ids`) and, with `--apply`, canonicalizes (`normalized_ids`) only BSON ObjectId values at `migrationSource.documentId` on existing v3 documents. The update matches the original document ID and provenance value and changes only that field; legacy raw documents, descriptors, evidence and dates stay untouched.
4. Conditional actual-Mongo smoke (requires configured real Mongo; never claim a stub proves it): compare retained legacy document IDs/counts/BSON sizes with the backup; verify the partial unique index and absence of the obsolete unique key; compare migrated descriptors/evidence/receipt dates against originals. For two real acquired symbols sharing company type/section, read each through `MongoMarketDataService.get_reference_records`; each result must have its own outer symbol and exact `descriptorEvidence`, with no aggregate descriptor map. Refresh one symbol only, confirm the other document and legacy originals remain byte-equivalent. Use `$bsonSize` over `schemaVersion=3` documents and record maximum size, distinct symbol count and per-section counts; historical near-16MiB raw documents are not served and must not be miscounted as failures.
5. Resume the bounded native financial acquisition against the existing checkpoint and exact affected symbol list; use `financials` for combined statement/ratio acquisition, not an independent ratio provider pass. A financial receipt may remain failed for structured admission while raw acquisition succeeds; retain partial committed counts and report those outcomes separately. Do not reset unrelated succeeded receipts. Index/schema repair does not weaken unit, fiscal, source-conflict or descriptor guards.

## Archived maintenance

`maintain_vietcap_corpus.py` and maintenance functions remain archived for separate controlled operations. The backfill CLI has no destructive reconciliation option or maintenance call path. Do not run maintenance as part of ingestion.

## Read-only coverage inventory

Run from `apps/api`, supplying an already captured Trading `getAll` response (JSON list or an object with `instruments`/`data`). No universe/provider request is repeated:

```bash
python scripts/verify_database.py --inventory --universe-json /path/to/universe.json \
  --env-file /home/compute_01/.config/vnibb/data.local.env
python scripts/verify_database_selfcheck.py
```

The opt-in JSON report separates physical SQL and Mongo datasets, stock-type/currently-listed/active-SQL universes, expected/present/missing symbols, retained time/fiscal-period bounds, SQL null/nonnull/descriptor-unit-admitted fields, and raw Mongo admission-unavailable reasons. It discovers the current premium allowlist without importing MCP or invoking providers. SQL statements run in a rolled-back read-only transaction; Mongo uses only read queries. Missing collections/tables are `unavailable`, not failed reads or proof of full-session replay. Query failures return a sanitized exception type and exit 1; valid empty/unavailable inventories return 0. No payloads, credentials or database URLs are printed.

Refresh/history declarations cite existing ingestion owners; unknown scopes remain explicit rather than inventing a symbol denominator. SQL flows, SQL ticks, Mongo raw ticks, typed ticks and depth are separate inventories. Bounds and ingestion times are not exchange-session completeness or source freshness. IQ field admission uses retained scoped descriptors/unit evidence; free VCI and legacy fields remain counted but unverified by this inventory. QA contract IDs refer to the authoritative #111 extension index; inventory does not certify ticket outcomes or authenticated Matrix acceptance. The legacy no-argument invocation remains unchanged, including its VCI connectivity call; use `--inventory` for provider-free operation. Neither command above was executed during this change.

### Bounded SQL statement admission inventory

For a separate field-level baseline, run from `apps/api` against the retained SQL store using a **read-only database account** and a private dotenv file containing `DATABASE_URL_SYNC` (or `DATABASE_URL`). With `--env-file`, only its explicit URL is used; inherited database URLs and the working directory's dotenv files are ignored. If both keys are present, `DATABASE_URL_SYNC` takes precedence. Missing URLs, duplicate URL keys, malformed dotenv syntax and `${...}` interpolation fail closed. Without `--env-file`, the corresponding process environment URL is used instead. Provision only SELECT permissions on `income_statements`, `balance_sheets`, and `cash_flows`. This command makes no provider or Mongo requests and performs no writes:

```bash
python -m scripts.financial_admission_inventory \
  --symbols FPT,VCI,VNM,MSR --periods 2025,Q1-2025,Q2-2025,Q3-2025,Q4-2025 \
  --env-file /path/to/private-readonly.env > /path/to/private-financial-inventory.json
```

The symbol/period list is an operator-selected denominator, not a claim that every listed company must publish every report. Supply the exact years and quarters intended for the QA cases; at most 50 symbols and 40 periods per run. The output enumerates each symbol × period × statement cell and each SQL monetary column, including nulls, zeroes, source identity, lineage presence, admission/withholding reason, unsupported source, missing row, and consumer faults. Invalid fiscal years outside 1900–2100 and unclassified fiscal identities are reported separately, outside the cell denominator. Matching cells use stored fiscal columns, not a guessed period inferred from text. Reads exceeding 10,000 rows per table fail rather than silently truncate. A failed SQL query or consumer fault exits nonzero; no credentials, SQL values, or raw evidence are printed. Store the output privately and review source-use rights independently.

Admission calls the actual MCP generic SQL collection serializer and its source allowlist, before sorting and pagination. It does not determine whether a particular limited MCP request selects the row; it is not the MCP latest/snapshot, equity HTTP merged response, or a provider-availability test. It does not establish source provenance, source rights, or deployed image identity. Record the deployed API/frontend identities separately; run the inventory with code matching the serving API artifact. PostgreSQL uses a verified repeatable-read read-only transaction, local timeouts and rollback; SQLite opens an existing file in read-only mode and rolls back. This is distinct from the descriptor heuristic in `verify_database.py` above.


## Regression check

Not executed during this change:

```bash
python -m pytest tests/test_api/test_vietcap_backfill.py -q
```
