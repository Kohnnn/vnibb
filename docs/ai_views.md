# AI Views

This document lists database views that simplify AI read access.

Current runtime note:

- the active copilot path is Appwrite-first and only falls back to Postgres when Appwrite context is missing
- source attribution is validated against the backend `source_catalog`
- these views are useful for future SQL-backed AI read models, but the current copilot does not execute arbitrary SQL

## ai_stock_snapshot

Latest per-symbol snapshot for AI use cases.

Includes:
- Stock profile (`stocks`)
- Latest daily close (`stock_prices`)
- Latest order flow (`order_flow_daily`)
- Latest foreign trading (`foreign_trading`)
- Latest screener metrics (`screener_snapshots`)

Usage example:

```sql
SELECT * FROM ai_stock_snapshot WHERE symbol = 'VNM';
```
