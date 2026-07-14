# VNIBB BigQuery — Connected Sheets Queries

BigQuery is an externally managed warehouse integration. This repository does not provision, own, synchronize, or verify its live schema, table count, row count, retention, or access policy. Confirm all metadata with the warehouse administrator before use.

## Access and cost

Use a distinct read-only Google principal where possible:

- Grant the principal dataset read access, such as `BigQuery Data Viewer`, only for the intended dataset.
- Grant `BigQuery Job User` only on the billed job project.
- Do not grant editor, owner, write, transfer, or routine-creation roles for this Sheets workflow.
- The billing project and dataset project can differ. Billing must be enabled for query jobs.
- Set a BigQuery maximum-bytes-billed limit or dry run in the console. Connected Sheets does not inherit the Apps Script `CONFIG.maxBytesBilled` cap.

The Apps Script client uses configurable `CONFIG.projectId`, `CONFIG.datasetProject`, `CONFIG.datasetId`, `CONFIG.location`, and `CONFIG.maxBytesBilled`. `location` defaults to `asia-southeast1`; change it only to match the externally managed dataset location.

## Verify the warehouse

Run these Standard SQL queries in the dataset's actual location. For the default configuration, the metadata region is `region-asia-southeast1`.

```sql
SELECT table_name, table_type
FROM `vnibb-data.region-asia-southeast1.INFORMATION_SCHEMA.TABLES`
WHERE table_schema = 'vnibb'
ORDER BY table_name;
```

```sql
SELECT
  t.table_name,
  t.table_type,
  ROUND(IFNULL(s.active_logical_bytes, 0) / POW(1024, 2), 1) AS active_logical_mb
FROM `vnibb-data.region-asia-southeast1.INFORMATION_SCHEMA.TABLES` AS t
LEFT JOIN `vnibb-data.region-asia-southeast1.INFORMATION_SCHEMA.TABLE_STORAGE` AS s
  USING (table_catalog, table_schema, table_name)
WHERE t.table_schema = 'vnibb'
ORDER BY active_logical_mb DESC, t.table_name;
```

```sql
SELECT column_name, data_type, is_nullable
FROM `vnibb-data.region-asia-southeast1.INFORMATION_SCHEMA.COLUMNS`
WHERE table_schema = 'vnibb'
  AND table_name = '{{TABLE_NAME}}'
ORDER BY ordinal_position;
```

Replace project, region, dataset, and table placeholders to match the managed warehouse. `INFORMATION_SCHEMA` uses Standard SQL and replaces legacy `__TABLES__` metadata.

## Query rules

Connected Sheets and the Apps Script client should run one read-only `SELECT` or `WITH` statement. Use one optional trailing semicolon. Do not use comments, scripts, DDL, DML, `CALL`, `EXPORT`, or multiple statements.

Apply filters, partition predicates, and `LIMIT` before refreshing Sheets. A row limit does not necessarily reduce scanned bytes.

## Verified-schema-only examples

Do not assume any table or column below exists or has a native type. Verify it with `INFORMATION_SCHEMA.COLUMNS` first. If a value is stored as `STRING`, use `SAFE_CAST`; if it is native numeric/date/timestamp data, query it directly.

```sql
SELECT symbol, trade_date, close
FROM `{{PROJECT}}.{{DATASET}}.{{PRICE_TABLE}}`
WHERE UPPER(symbol) = '{{TICKER}}'
  AND trade_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {{DAYS}} DAY)
ORDER BY trade_date DESC
LIMIT {{LIMIT}};
```

```sql
WITH latest AS (
  SELECT
    symbol,
    metric_value,
    observed_at,
    ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY observed_at DESC) AS rn
  FROM `{{PROJECT}}.{{DATASET}}.{{METRIC_TABLE}}`
  WHERE UPPER(symbol) IN ({{TICKER_LIST}})
)
SELECT symbol, metric_value, observed_at
FROM latest
WHERE rn = 1
ORDER BY symbol;
```

## Gemini prompt constraints

Tell Gemini to output exactly one Standard SQL `SELECT` or `WITH` query, with no comments or markdown. Give it only verified table and column names. Review the output and expected bytes scanned before execution. The Apps Script bridge validates this grammar again, but validation is a guardrail, not a substitute for least-privilege IAM or cost review.
