# Docs Index

`vnibb/docs` is the canonical maintainer-facing documentation tree for the active application repo.

## Core References

- `API_REFERENCE.md`: API-level reference material for the backend surface
- `DATABASE_SCHEMA.md`: database stack schema and collection model
- `WIDGET_SYSTEM_REFERENCE.md`: canonical non-TradingView widget rules and behavior
- `WIDGET_IMPROVEMENT_ROADMAP.md`: structured priorities, shipped work, and follow-up work
- `WORLD_NEWS_MONITOR_IMPLEMENTATION.md`: implementation/run log for the live world news monitor suite
- `TRADINGVIEW_WIDGET_CATALOG.md`: current TradingView widget coverage and status
- `POSTHOG_ANALYTICS.md`: frontend analytics setup, event coverage, privacy rules, and env contract

## Operations And Data

Current source of truth:

- VNIBB persistence is fully self-hosted on n6v (Tailscale `100.72.199.91`, private network only, no cloud database): MongoDB `vnibb-market` corpus (`:27017`), self-hosted Supabase Postgres app model (`:15433`/`:16543`), and Redis cache (`:6379`). Reachable from the OCI backend over Tailscale; portable to other infrastructure in the future.

- `DEPLOYMENT_AND_OPERATIONS.md`: deployment profile, Oracle runtime guidance, and ops notes
- `DATABASE_SCHEMA.md`: database stack schema and collection model
- `APPWRITE_PRIMARY_SUPABASE_WRITE_BRIDGE.md`: canonical durable-store, Appwrite-write-freeze, and write-bridge contract
- `AUTO_UPDATE_STRATEGY.md`: automatic update plan, rate-budget strategy, and scheduler model
- `VN100_EOD_BACKFILL_PLAN.md`: VN100 2008-to-now EOD bootstrap plan for quant/backtesting widgets
- `daily_trading_updater.md`: trading-flow updater behavior and reinforced scheduler notes
- `data_retention_partitioning.md`: retention and partitioning guidance

## Product And Architecture

- `MCP_STRATEGY.md`: MCP applicability and agent integration ideas
- `VNIBB_MCP_READONLY.md`: implemented read-only MCP server for VNIBB database-stack access
- `VNIBB_MCP_DEPLOYMENT.md`: dedicated OCI deployment and smoke-check reference for `vnibb-mcp`
- `DEVELOPMENT_JOURNAL.md`: maintainer journal and decision history
- `WIDGET_CATALOG.md`: legacy widget snapshot, useful as historical context only
- `NEXT_PHASES_EXECUTION_PLAN.md`: execution-ready plan for the next selected product phases
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
