# Ask-in-English → BigQuery → Google Sheets

Client: `apps/api/scripts/apps_script_bigquery_client.gs`.

Gemini generates SQL, then the Apps Script BigQuery advanced service runs it and writes the result to a Sheet. The warehouse is externally managed: verify its ownership, schema, location, table count, data types, and IAM with its administrator. This repository does not assert live warehouse metadata.

## Setup

1. Open a Sheet and paste the client into **Extensions → Apps Script**.
2. Add the **BigQuery API** advanced service.
3. Add `GEMINI_API_KEY` in **Project Settings → Script properties**. Do not paste keys into source.
4. Set `CONFIG.projectId` to the billed job project and `CONFIG.datasetProject`, `CONFIG.datasetId`, and `CONFIG.location` to the managed dataset values. The defaults target `asia-southeast1`; the location must match the dataset.
5. Set `CONFIG.maxBytesBilled` to the maximum acceptable scan per job. The default is 10 GiB. Set `CONFIG.maxRows` and `CONFIG.maxSheetCells` for the expected result size.
6. Reload the Sheet and authorize BigQuery, Sheets, and external requests.

## IAM

Use a dedicated read-only Google principal where possible. It needs job creation on the billed project and dataset read access only. Do not give this workflow write, owner, transfer, routine-creation, or broad project roles. Gemini has no BigQuery credential; BigQuery executes as the Apps Script user.

## Execution guardrails

Before every direct or Gemini query, the client accepts only one read-only Standard SQL `SELECT` or `WITH` statement. It rejects comments, multiple statements, scripts, DDL, DML, and other obvious bypass forms. It applies `maximumBytesBilled` to each job and checks the Sheet cell budget before `setValues()`.

Run `sqlValidatorSelfCheck()` from the Apps Script editor to exercise accepted and rejected SQL cases without BigQuery credentials.

The validator is not an authorization boundary. IAM and BigQuery's query-cost controls remain required.

## Use

- **Ask in plain English** opens a dialog, shows the generated SQL, and asks for confirmation.
- **Run English from SQL sheet** reads the question from `⚙ SQL!B1`, writes generated SQL to `A1`, then runs it.
- **Run Custom SQL** reads `⚙ SQL!A1`; it receives the same read-only validation and byte cap.

If BigQuery rejects a query, inspect `⚙ SQL!A1`, verify columns using `INFORMATION_SCHEMA`, and retry with a bounded query.

## Types and metadata

Do not assume JSON or native types. Query `INFORMATION_SCHEMA.COLUMNS` before selecting or casting fields. `listTables()` uses Standard SQL `INFORMATION_SCHEMA` metadata for the configured location, not legacy `__TABLES__`; it lists current metadata but does not prove a fixed table count.

See `BQ_CONNECTED_SHEETS_QUERIES.md` for IAM, cost, metadata, and query examples.
