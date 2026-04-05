# Screener Snapshots Appwrite Recovery

Date: 2026-04-04

## Current finding

`screener_snapshots` is still blocked by Appwrite schema processing.

Important observation from live tests:

- recreating the collection can unstick `price`
- but another later attribute can still get stuck in `processing`
- in the latest sequential recreate test, `roic` became the stuck attribute

So the safest approach is not to bulk-create the full schema at once.

Use small manual batches in the Appwrite console and wait for each batch to become fully `available` before adding the next one.

## Collection settings

- Collection ID: `screener_snapshots`
- Name: `Screener Snapshots`
- Permissions: public read
- Document security: off

## Step 1. Delete and recreate the collection

In Appwrite console:

1. Delete the existing `screener_snapshots` collection.
2. Wait until it disappears completely from the collections list.
3. Recreate it with the same collection ID: `screener_snapshots`.
4. Do not add indexes yet.
5. Do not add query overlay attributes yet.

After recreating, wait 1-2 minutes before adding columns.

## Step 2. Add source columns in 4 small batches

All columns below should be created as:

- type: `longtext`
- required: `false`
- array: `false`

After each batch:

1. wait until every column in that batch is `available`
2. refresh the console
3. only then move to the next batch

### Batch 1. Identity and dimensions

- `id`
- `symbol`
- `snapshot_date`
- `company_name`
- `exchange`
- `industry`
- `source`
- `created_at`

### Batch 2. Core market metrics

- `price`
- `volume`
- `market_cap`
- `pe`
- `pb`
- `ps`
- `ev_ebitda`

### Batch 3. Profitability and growth

- `roe`
- `roa`
- `roic`
- `gross_margin`
- `net_margin`
- `operating_margin`
- `revenue_growth`
- `earnings_growth`
- `dividend_yield`

### Batch 4. Balance sheet and ranking fields

- `debt_to_equity`
- `current_ratio`
- `quick_ratio`
- `eps`
- `bvps`
- `foreign_ownership`
- `rs_rating`
- `rs_rank`
- `extended_metrics`

## Step 3. Add query overlay attributes

Only add these after all source columns are `available`.

### Batch 5. Query overlay fields

- `symbol_q`
  - type: `string`
  - size: `16`
- `snapshot_date_dt`
  - type: `datetime`
- `exchange_q`
  - type: `string`
  - size: `16`
- `industry_q`
  - type: `string`
  - size: `128`
- `market_cap_f`
  - type: `float`

Wait until all 5 are `available` before adding indexes.

## Step 4. Add indexes

Only add indexes after all overlay fields are `available`.

- `idx_symbol_q`
  - attributes: `symbol_q`
- `idx_snapshot_dt`
  - attributes: `snapshot_date_dt`
- `idx_snap_ind_q`
  - attributes: `snapshot_date_dt`, `industry_q`
- `idx_snap_mcap_f`
  - attributes: `snapshot_date_dt`, `market_cap_f`

## Step 5. Populate Appwrite

After the collection is stable, run this from `vnibb/`:

```bash
set APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
set APPWRITE_PROJECT_ID=69a9c5ab0003bd4e280c
set APPWRITE_API_KEY=<your_appwrite_key>
set APPWRITE_DATABASE_ID=69a9c70d0026c7d08f51
set MIGRATION_DRY_RUN=false
set MIGRATION_COERCE_ALL_TO_STRING=true
set MIGRATION_BATCH_SIZE=300
set MIGRATION_CONCURRENCY=4
set MIGRATION_PAGINATION_MODE=keyset
set MIGRATION_RESUME=false
set MIGRATION_MAX_ROWS=0
set MIGRATION_TABLES=screener_snapshots
node .\scripts\appwrite\migrate_supabase_to_appwrite.mjs
```

## If a batch gets stuck again

If any column in a batch stays in `processing` for more than 15-20 minutes:

1. stop adding more columns
2. do not start the migration yet
3. either wait longer or recreate the collection again
4. resume from the last fully successful batch only

## Why this order

This order is intentionally conservative:

- batch 1 isolates identifiers and low-risk text fields
- batch 2 isolates the core valuation metrics where `price` previously got stuck
- batch 3 isolates profitability/growth fields where `roic` later got stuck
- batch 4 isolates balance/ranking fields that are least important for first-write validation

That keeps failures localized and makes it much easier to tell which field is poisoning schema processing.
