# Google Apps Script → Sheets Integration

Read-only VNIBB API data in Google Sheets. Client: `apps/api/scripts/apps_script_client.gs`.

## Setup

1. Open a Sheet, then **Extensions → Apps Script**.
2. Paste the client into `Code.gs`.
3. In **Project Settings → Script properties**, set `VNIBB_APPS_SCRIPT_KEY` to the server value.
4. Set `CONFIG.baseUrl` to the deployed `/api/v1/apps-script` base URL. Leave `CONFIG.apiKey` as `''`; it is only a local fallback for private script copies.
5. Run `demo()` and approve Sheets and external-request authorization.

The API requires `X-API-Key` on every request. The server compares it with `VNIBB_APPS_SCRIPT_KEY`. No key belongs in this repository.

## API contract

Source: `apps/api/vnibb/api/v1/apps_script.py`.

| Path | Result |
|---|---|
| `GET /financials/{symbol}` | Flat statement rows; `statement_type`, `period`, `limit` |
| `GET /ratios/{symbol}` | Flat ratio row(s) |
| `GET /screener` | Flat screener rows |
| `GET /historical/{symbol}` | Flat OHLCV rows; `start_date` required |
| `GET /quote/{symbol}` | Wrapped response with quote under `data` |
| `GET /listing` | Symbol rows |
| `GET /market/indices` | Index rows |
| `GET /health` | Service health |

`writeRowsToSheet()` routes every value through `cellValue_()`: secret-like columns (`api_key`, `X-API-Key`, …) are redacted, nested values are JSON-stringified because `setValues()` accepts scalar cell values only, and numbers pass through unchanged — the serving pipeline owns their scale, so the client never silently re-units prices. Before any `setValues()` call, it enforces `CONFIG.maxSheetCells` (default `10000000`); narrow the request rather than increasing it past the Sheets limit.

## Bounded pulls with provenance

The legacy endpoints above stay as-is for existing formulas. `GET /bounded/{dataset}` is the opt-in companion: same serving pipeline, same `X-API-Key`, wrapped in a provenance envelope that tells the reader what they are looking at:

```json
{
  "data": [ { "symbol": "VNM", "trade_date": "2025-07-15", "pe": 18.5 } ],
  "error": null,
  "meta": {
    "dataset": "screener",
    "query": { "dataset": "screener", "limit": 100, "exchange": "HOSE" },
    "count": 1,
    "limit": 100,
    "availability": "available",
    "source": "cache",
    "source_date": "2025-07-15",
    "retrieved_at": "2026-10-04T00:00:00Z",
    "limitations": [ "…" ]
  }
}
```

- `availability` is `available`, `partial`, `empty`, or `unavailable`; retained rows plus an upstream error are partial, not silently discarded.
- `source_date` is the newest explicit observation date carried by returned rows (screener `trade_date`, historical `time`, index `time`/`date`). It is **not whole-dataset freshness**. `undated_row_count` flags rows without an observation date; `source_date_basis` states this scope. Store `updated_at`, fiscal period labels, and fetch time never become source dates. Unknown dates remain `null` and render as `unknown`.
- `source` is the serving mode from existing handlers (e.g. `fallback_cache` or historical `merged`), not the requested provider. Missing supplier provenance stays `null`. `serving_meta` retains the pipeline's source counts, fallback/staleness, units, completeness and warnings alongside the limitations. Financials/ratios reuse the equity serving handlers, screener/listing reuse the cache-aware screener, and indices reuse the market handler.
- Limits are 1–2000 rows, financials 1–20 periods; the default is 5. Historical date ranges cannot exceed 1826 calendar days. `data` never exceeds the applied limit.
- Client functions: `pullBoundedFinancials`, `pullBoundedScreener`, `pullBoundedHistorical`, `pullBoundedRatios`, `pullBoundedListing`. The VNIBB menu exposes them. Each always writes a companion provenance tab scoped to the exact request (e.g. `VNM income (year) provenance` vs `VNM income (quarter) provenance`; `Screener (HOSE) provenance`; `VNM OHLCV provenance`) with limits, source, observation-date basis, undated-row count, serving metadata, limitations and errors. Empty/unavailable pulls clear previous data so stale values cannot masquerade as current results; unavailable pulls then raise an actionable error. Keys are stored only in Script Properties/co...

Examples from the Apps Script editor:

```javascript
pullBoundedFinancials('VNM', 'income', 'year', 5);
pullBoundedScreener('HOSE', 100, null, 'KBS');
pullBoundedHistorical('VNM', '2025-01-01', '2025-12-31', '1D', 250);
pullBoundedRatios('VNM', 'quarter');
pullBoundedListing('HOSE', 100);
```

## Smoke harness (deterministic, offline)

`apps/api/scripts/apps_script_client_test.js` loads `apps_script_client.gs` verbatim into a Node VM with mocks for `UrlFetchApp`, `SpreadsheetApp`, `PropertiesService`, `Session` and `Utilities`, then executes the real client functions — `fetchBounded_`, `provenanceRows_`, `writeProvenanceBlock_`, `cellValue_`, `boundedClampLimit_`, `assertBoundedRange_` and the `pullBounded*` functions — against scripted envelope fixtures. No network, no Google services, deterministic output.

```sh
node apps/api/scripts/apps_script_client_test.js
```

Expect exit code 0 with every check passing. The harness exercises the actual bounded client, auth headers, unknown source dates, provenance cells, safe scalar writes/key redaction, limits/ranges, unavailable errors, and legacy cell formulas. Final checks are parent-owned.

For a live end-to-end smoke, run `demo()` in the Apps Script editor after setup (Section “Setup”), then `pullBoundedFinancials('VNM')` and inspect the `VNM income (year) provenance` tab: `source_date` is `unknown`, `retrieved_at` is the pull time, and `availability` is `available` when the pipeline answered.

## Custom functions

`VNIBB_QUOTE`, `VNIBB_RATIO`, and `VNIBB_FINANCIAL` make live API requests. The client does not implement caching. Avoid filling many cells with them; use a scheduled `pull*` function and reference its output tab instead.

## Errors

- `401`: key does not match the server.
- `422`: missing or invalid request parameter, including a missing API-key header.
- `503`: server has no `VNIBB_APPS_SCRIPT_KEY` configured.

## BigQuery

The REST integration is for bounded API pulls. BigQuery and Connected Sheets are separate, externally managed warehouse integrations; verify warehouse schema, table count, location, ownership, and access with the warehouse administrator before use. See `BQ_CONNECTED_SHEETS_QUERIES.md` and `GEMINI_BIGQUERY_SHEETS_SETUP.md`.
