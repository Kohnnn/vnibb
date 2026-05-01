# Docs Index

`vnibb/docs` is the canonical maintainer-facing documentation tree for the active application repo.

## Core References

- `API_REFERENCE.md`: API-level reference material for the backend surface
- `APPWRITE_SCHEMA.md`: Appwrite schema and collection model
- `WIDGET_SYSTEM_REFERENCE.md`: canonical non-TradingView widget rules and behavior
- `WIDGET_IMPROVEMENT_ROADMAP.md`: structured priorities, shipped work, and follow-up work
- `WORLD_NEWS_MONITOR_IMPLEMENTATION.md`: implementation/run log for the live world news monitor
- `TRADINGVIEW_WIDGET_CATALOG.md`: current TradingView widget coverage and status
- `POSTHOG_ANALYTICS.md`: frontend analytics setup, event coverage, privacy rules, and env contract

## Operations And Data

Current-month source of truth:

- follow `APPWRITE_PRIMARY_SUPABASE_WRITE_BRIDGE.md` first for the intended Appwrite-primary architecture plus the temporary quota-pressure write bridge
- treat `APPWRITE_FREEZE_SUPABASE_PRIMARY.md` as the historical temporary runbook that captured one stricter Supabase-primary month posture

- `DEPLOYMENT_AND_OPERATIONS.md`: deployment profile, Oracle runtime guidance, and ops notes
- `APPWRITE_VNSTOCK_ROLLOUT.md`: Appwrite rollout strategy, schema, and migration history
- `APPWRITE_PRIMARY_SUPABASE_WRITE_BRIDGE.md`: Appwrite-primary architecture and temporary Supabase write-bridge guidance
- `APPWRITE_FREEZE_SUPABASE_PRIMARY.md`: Appwrite quota-freeze operating mode and Supabase-primary runbook
- `AUTO_UPDATE_STRATEGY.md`: automatic update plan, rate-budget strategy, and scheduler model
- `daily_trading_updater.md`: trading-flow updater behavior and reinforced scheduler notes
- `SCREENER_SNAPSHOTS_APPWRITE_RECOVERY.md`: last-mile recovery notes for the screener Appwrite collection
- `data_retention_partitioning.md`: retention and partitioning guidance

## Product And Architecture

- `MCP_STRATEGY.md`: MCP applicability and agent integration ideas
- `VNIBB_MCP_READONLY.md`: implemented read-only MCP server for Appwrite-backed VNIBB access
- `VNIBB_MCP_DEPLOYMENT.md`: dedicated OCI deployment and smoke-check reference for `vnibb-mcp`
- `DEVELOPMENT_JOURNAL.md`: maintainer journal and decision history
- `WIDGET_CATALOG.md`: legacy widget snapshot, useful as historical context only
- `NEXT_PHASES_EXECUTION_PLAN.md`: execution-ready plan for the next selected product phases

## TradingView / Global Markets

- `TRADINGVIEW_WIDGET_IMPLEMENTATION_PLAN.md`
- `TRADINGVIEW_GLOBAL_MARKETS_IMPLEMENTATION_PLAN.md`
- `TRADINGVIEW_WIDGET_CATALOG.md`

## Oracle / Deployment Runbooks

- `oracle_migration_plan.md`
- `oracle_rollback_plan.md`
- `oracle_runbook.md`
- `admin_global_system_layouts.md`
- `appwrite_system_layouts_manual_setup.md`

## Note On Root Docs

The root `docs/` folder is now a lighter project-level overview set.

For backend, scheduler, Appwrite, and maintainer-operational references, prefer `vnibb/docs/` first.
