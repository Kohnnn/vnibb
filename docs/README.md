# Docs Index

`vnibb/docs` is the canonical maintainer-facing documentation tree for the active application repo.

## Core References

- `API_REFERENCE.md`: API-level reference material for the backend surface
- `APPS_SCRIPT_SHEETS.md`: Google Apps Script / Sheets read-only API integration
- `BQ_CONNECTED_SHEETS_QUERIES.md`: externally managed BigQuery and Connected Sheets access, metadata, IAM, and query guidance
- `GEMINI_BIGQUERY_SHEETS_SETUP.md`: Gemini-to-BigQuery Apps Script setup and execution guardrails
- `DATABASE_SCHEMA.md`: database stack schema and collection model
- `WIDGET_SYSTEM_REFERENCE.md`: canonical non-TradingView widget rules and behavior
- `WIDGET_IMPROVEMENT_ROADMAP.md`: structured priorities, shipped work, and follow-up work
- `WORLD_NEWS_MONITOR_IMPLEMENTATION.md`: implementation/run log for the live world news monitor suite
- `TRADINGVIEW_WIDGET_CATALOG.md`: current TradingView widget coverage and status
- `POSTHOG_ANALYTICS.md`: frontend analytics setup, event coverage, privacy rules, and env contract
- `openbb-assessment.md`: OpenBB-finance public repository inventory, licensing changes, and VNIBB adoption priorities (2026-09-26)

## Operations And Data

Current source of truth:

- The executable Oracle deployment defines PostgreSQL (`vnibb-db`), MongoDB (`vnibb-mongo`, database `vnibb-market`) and Redis (`vnibb-redis`) on the application host. The last recorded production release retained those containers and their volumes; inspect actual mounts and connection targets before recovery. Older n6v instructions describe a separate historical topology, not proof of current routing.
- Vietnamese structured-data ingestion uses Vietcap IQ/Trading first, then free `vnstock` VCI only where supported. KBS, TCBS and sponsor packages are not runtime fallbacks. Raw provider records, descriptor evidence and source units remain available alongside admitted structured fields.
- Local database startup uses `docker-compose.data.local.yml`, private credentials and loopback ports `55432` / `57017`; see `oracle_runbook.md` for setup and the distinct production recovery procedure.

- `DEPLOYMENT_AND_OPERATIONS.md`: deployment profile, Oracle runtime guidance, and ops notes
- `DATABASE_SCHEMA.md`: database stack schema and collection model
- `AUTO_UPDATE_STRATEGY.md`: automatic update plan, rate-budget strategy, and scheduler model
- `daily_trading_updater.md`: trading-flow updater behavior and reinforced scheduler notes
- `data_retention_partitioning.md`: retention and partitioning guidance
- `BACKUP_RESTORE_DRILL.md`: backup artifacts, the repeatable restore drill (`scripts/oracle/verify-backup.sh`), and last-verified evidence

## Product And Architecture

- `MCP_STRATEGY.md`: MCP applicability and agent integration ideas
- `VNIBB_MCP_READONLY.md`: implemented read-only MCP server for VNIBB database-stack access
- `VNIBB_MCP_DEPLOYMENT.md`: dedicated OCI deployment and smoke-check reference for `vnibb-mcp`
- `DEVELOPMENT_JOURNAL.md`: maintainer journal and decision history
- `WIDGET_CATALOG.md`: legacy widget snapshot, useful as historical context only
- `archive/`: superseded plans kept for history, each carrying an archived
  header. Do not action anything in there without checking that header first.
- `PRODUCT_INFRA_DATA_EXECUTION_PLAN.md`: active product trust, OCI hardening, n6v backup/Parquet, rate-limit, and scheduler rollout plan and progress
- `V1_6_1_BACKEND_DATA_EXECUTION_PLAN.md`: v1.6.1 backend observability, corpus quality, database, performance, hardening, and rollout plan and progress
- `VNIBB_PRODUCT_IMPROVEMENT_EXECUTION_PLAN.md`: active research, discovery, investor workflow, activation, and product-enabling platform plan and progress
- `WAVE_5_5_STRATEGY_EDITOR_SANDBOX_DESIGN.md`: design-only strategy editor sandbox threat model, gates, and hard rules
- `reverse-engineering/turtle-hub-crawl-2026-06-09/`: public Turtle Hub feature crawl, Quant deep dive, and VNIBB widget/news improvement ideas
- `reverse-engineering/fincept-quantcept-terminal-crawl-2026-06-09/`: public Quantcept and FinceptTerminal feature/tech-stack crawl mapped to VNIBB widget, agent, analytics, and platform ideas

## TradingView / Global Markets

- `TRADINGVIEW_WIDGET_IMPLEMENTATION_PLAN.md`
- `TRADINGVIEW_GLOBAL_MARKETS_IMPLEMENTATION_PLAN.md`
- `TRADINGVIEW_WIDGET_CATALOG.md`

## Oracle / Deployment Runbooks

- `oracle_rollback_plan.md`
- `oracle_runbook.md`
- `admin_global_system_layouts.md`

## Note On Root Docs

The root `docs/` folder is now a lighter project-level overview set.

For backend, scheduler, database, and maintainer-operational references, prefer `vnibb/docs/` first.
