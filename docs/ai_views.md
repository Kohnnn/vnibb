# AI Views

This document lists database views that simplify AI read access.

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
