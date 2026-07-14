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

`writeRowsToSheet()` JSON-serializes nested values because `setValues()` accepts scalar cell values only. Before either `setValues()` call, it enforces `CONFIG.maxSheetCells` (default `10000000`); narrow the request rather than increasing it past the Sheets limit.

## Custom functions

`VNIBB_QUOTE`, `VNIBB_RATIO`, and `VNIBB_FINANCIAL` make live API requests. The client does not implement caching. Avoid filling many cells with them; use a scheduled `pull*` function and reference its output tab instead.

## Errors

- `401`: key does not match the server.
- `422`: missing or invalid request parameter, including a missing API-key header.
- `503`: server has no `VNIBB_APPS_SCRIPT_KEY` configured.

## BigQuery

The REST integration is for bounded API pulls. BigQuery and Connected Sheets are separate, externally managed warehouse integrations; verify warehouse schema, table count, location, ownership, and access with the warehouse administrator before use. See `BQ_CONNECTED_SHEETS_QUERIES.md` and `GEMINI_BIGQUERY_SHEETS_SETUP.md`.
