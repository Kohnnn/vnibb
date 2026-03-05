# VNIBB Appwrite Migration Prompt (Production)

Use this prompt with a migration-focused coding agent.

```text
System Goal:
Migrate VNIBB (production investment analytics app) from Supabase + Upstash Redis to Appwrite Cloud while preserving 100% financial data integrity and supporting rollback.

Current Stack:
- Backend: FastAPI on Zeabur
- Frontend: Next.js on Vercel
- Database: Supabase Postgres (project ref cbatjktmwtbhelgtweoi)
- Cache: Upstash Redis (id 800c83d6-e1a4-443f-93b1-d1dbad3bb01d)

Target Stack:
- Appwrite Cloud for Database + Auth + Storage (+ cache-like ephemeral data patterns)
- Keep Zeabur and Vercel as runtime hosts

Constraints:
1) No loss of historical market data.
2) Avoid numeric precision loss for money, valuation, and ratio fields.
3) Migration must be idempotent and resumable.
4) Include rollback strategy.

Tasks:

1. Schema Mapping
- Map Postgres tables to Appwrite collections.
- Use document-ID relationships for foreign keys.
- Propose indexes for high-traffic query dimensions (`symbol`, `time`, `trade_date`, `user_id`).
- Include mappings for key VNIBB domains:
  `stocks`, `stock_prices`, `intraday_trades`, `income_statements`, `balance_sheets`, `cash_flows`, `financial_ratios`, `screener_snapshots`, `company_news`, `market_news`, `company_events`, `user_dashboards`, `dashboard_widgets`, `alert_settings`.

2. Data Migration Script (Node.js)
- Use `pg` for source and `node-appwrite` SDK for destination.
- Read from Postgres in batches and write in controlled concurrency.
- Convert timestamps to ISO 8601 strings.
- Use deterministic document IDs for idempotent upserts.
- On duplicate document, update instead of failing.
- Produce per-table metrics: read count, created count, updated count, failed count.

3. Precision Strategy
- For monetary and ratio fields, prevent precision drift.
- Recommend string storage for high-value/critical fields where needed.
- Include a verification pass that compares source vs destination sample checksums.

4. Redis Replacement Strategy
- Show how to replace Upstash calls with:
  - Appwrite collection-backed cache (key/payload/expires_at), or
  - Appwrite Functions for compute + short-lived cache patterns.
- Keep memory fallback path in backend for resilience.

5. Frontend Auth Client Migration
- Provide before/after snippets for:
  - Supabase init (`createBrowserClient`)
  - Appwrite init (`new Client().setEndpoint(...).setProject(...)`)
- Map login, signup, OAuth, and logout flows from Supabase APIs to Appwrite Account APIs.

6. Security Model Migration
- Replace Supabase RLS semantics with Appwrite Permissions:
  - Public read for market data
  - User-owned read/write for dashboard data
  - Service-only write for ingestion jobs

7. Cutover Plan
- Phase A: backfill immutable tables
- Phase B: dual-write
- Phase C: shadow-read compare
- Phase D: partial cutover
- Phase E: full cutover with rollback window

Deliverables:
- Production-ready migration script(s)
- Collection schema JSON templates
- Backend adapter examples (cache + auth integration points)
- Validation scripts and cutover checklist
```
