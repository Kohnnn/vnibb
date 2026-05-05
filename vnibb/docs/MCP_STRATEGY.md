# MCP Strategy

## Purpose

This page brainstorms how Model Context Protocol (MCP) can be applied to VNIBB in a way that fits the current product shape instead of bolting on a generic AI chat layer.

The goal is not "AI for everything". The goal is to give agents safe, structured access to VNIBB's existing strengths:

- normalized Vietnam-market data from the FastAPI backend
- dashboard and widget workflows in the frontend
- cached and fallback-aware provider logic
- Appwrite and Postgres operational tooling already present in the repo

## Why MCP fits VNIBB

VNIBB already has several pieces that map well to MCP:

- a typed backend with stable route contracts
- a widget-based research workspace where actions are composable
- an AI Copilot direction already present in the product
- existing Appwrite MCP launch scripts in `vnibb/scripts/appwrite/`
- a fallback-first backend that is better for agents than raw upstream provider access

This means VNIBB should usually expose MCP over VNIBB services, not over raw `vnstock` calls.

That keeps agents on normalized contracts, cached paths, and product-safe data.

## Core idea

Use MCP as an agent interface for VNIBB itself.

Instead of teaching every AI tool how to call many VNIBB REST endpoints directly, expose a curated MCP server with:

- tools for actions
- resources for read-only context
- prompts for common research workflows

## Best application areas

### 1. In-app Research Copilot

This is the most obvious fit.

Instead of a free-text assistant that only answers from prompts, the assistant can call tools such as:

- `get_symbol_snapshot`
- `get_price_history`
- `get_financial_summary`
- `get_peer_comparison`
- `get_sector_rotation`
- `get_news_digest`

What this enables:

- "Compare FPT vs CMG on growth, margins, valuation, and price momentum."
- "Why did banking stocks lead today?"
- "Summarize the latest catalysts for VCB and show risk flags."

Why this matters:

- the assistant stops hallucinating data access
- answers can be grounded in current cached VNIBB data
- the same tools can be reused in the web app, IDE agents, and automation jobs

### 2. Chat-to-Dashboard Actions

VNIBB is a workspace product, so MCP should not stop at read-only analysis.

High-value action tools:

- `list_dashboards`
- `create_dashboard`
- `add_widget`
- `update_widget_symbol`
- `set_sync_group`
- `save_layout`
- `open_research_view`

Example flows:

- "Create a banking dashboard with valuation, technical, and money-flow widgets."
- "Clone my current workspace and switch everything from VCB to MBB."
- "Add a peer comparison widget for FPT, CMG, CTR, and ELC."

This is a strong differentiator because MCP becomes a workspace automation layer, not just a Q and A layer.

### 3. Morning Brief and Research Agents

VNIBB already has the right data surfaces for recurring agent jobs.

Possible scheduled or on-demand agents:

- market open brief
- end-of-day wrap
- sector rotation brief
- symbol watchlist digest
- earnings and corporate events monitor
- abnormal volume and liquidity monitor

The MCP server can expose these either as:

- prompt templates like `prompt://morning-brief`
- higher-level tools like `generate_market_brief`

This gives you reusable analyst workflows inside the app and in external clients.

### 4. Data Ops and Reliability Assistant

This is one of the best non-obvious uses.

VNIBB has many backend and data-quality workflows that are hard to operate manually.

Admin-only MCP tools could include:

- `check_data_freshness`
- `get_sync_status`
- `trigger_symbol_backfill`
- `refresh_screener_cache`
- `verify_appwrite_counts`
- `inspect_migration_state`
- `check_backend_health`

Example prompts:

- "Why is the screener stale today?"
- "Check whether Appwrite is lagging behind Postgres for financial ratios."
- "Backfill price history for the VN30 names that failed today."

This fits the repo especially well because Appwrite MCP tooling already exists.

### 5. External IDE and Agent Access

VNIBB can expose an MCP server for Cursor, Claude Desktop, VS Code, Windsurf, and similar tools.

This would let external agents:

- inspect live market data through VNIBB instead of raw provider code
- fetch normalized company and market context
- interact with saved dashboards and watchlists
- run safe admin diagnostics in staging or production

This is especially useful for:

- internal research workflows
- support and debugging
- AI-assisted report generation
- custom automation by power users

### 6. Portfolio and Watchlist Automation

MCP can turn VNIBB into an action-oriented assistant for personal workflows.

Potential tools:

- `list_watchlists`
- `create_watchlist`
- `add_symbols_to_watchlist`
- `get_watchlist_changes`
- `summarize_watchlist_risks`

Example prompts:

- "Create a watchlist of liquid mid-cap industrials."
- "Show what changed in my growth watchlist since yesterday."
- "Rank my watchlist by earnings quality and balance-sheet risk."

## Tool families VNIBB could expose

### Market data tools

- `get_symbol_snapshot`
- `get_price_history`
- `get_intraday_summary`
- `get_order_flow_summary`
- `get_foreign_trading_summary`
- `get_financial_statements`
- `get_financial_ratios`
- `get_company_profile`
- `get_company_news`
- `get_company_events`
- `get_sector_snapshot`
- `get_top_movers`

### Workspace tools

- `list_dashboards`
- `create_dashboard`
- `duplicate_dashboard`
- `add_widget`
- `remove_widget`
- `set_dashboard_symbols`
- `save_layout`
- `publish_layout`

### Data and ops tools

- `get_job_status`
- `run_sync`
- `run_backfill`
- `check_cache_health`
- `check_data_freshness`
- `verify_appwrite_parity`
- `inspect_pipeline_errors`

### User workflow tools

- `list_watchlists`
- `create_watchlist`
- `update_watchlist`
- `get_saved_screens`
- `save_screen_result`

## Resource ideas

Resources are a strong fit for VNIBB because the app already has stable context surfaces that agents often need to read.

High-value resources:

- `docs://architecture`
- `docs://widget-catalog`
- `workspace://current-layout`
- `workspace://current-symbols`
- `watchlist://default`
- `market://calendar/today`
- `market://top-movers/latest`
- `screener://latest`
- `ops://freshness-report`

These are useful because not every question should become a tool call.

## Prompt template ideas

Prompt templates are good for recurring VNIBB workflows.

Examples:

- `prompt://morning-brief`
- `prompt://symbol-deep-dive`
- `prompt://peer-comparison`
- `prompt://sector-rotation-review`
- `prompt://earnings-prep`
- `prompt://ops-triage`

Each prompt can direct the agent toward the right tools and output structure.

## Architecture options

### Option A. Thin MCP adapter over existing VNIBB API

The MCP server calls the current FastAPI endpoints.

Pros:

- fastest path
- low risk
- reuses existing backend auth, cache, and normalization
- easiest to ship as a separate server

Cons:

- tools may mirror route design too closely
- less efficient for multi-step internal workflows

Best use:

- first MVP

### Option B. In-process MCP layer over backend services

The MCP server imports VNIBB service-layer code directly.

Pros:

- cleaner agent-oriented tool design
- avoids extra HTTP hops
- better for composite workflows

Cons:

- tighter coupling to backend internals
- more operational complexity

Best use:

- second phase after tool boundaries are proven

### Option C. Hybrid MCP architecture

Split responsibilities:

- public research tools call FastAPI routes
- admin tools call service internals or scripts
- Appwrite-specific tools stay separate where needed

Pros:

- practical
- matches current repo reality
- easier permission separation

Cons:

- more moving parts

Best use:

- likely long-term direction for VNIBB

## Recommended rollout

### Phase 1. Internal read-only MCP

Ship a small server with read-only market and company tools.

Recommended initial tools:

- `get_symbol_snapshot`
- `get_price_history`
- `get_financial_summary`
- `get_company_news`
- `get_sector_snapshot`
- `get_top_movers`
- `get_workspace_state`

Recommended transports:

- `stdio` first for local IDE usage
- HTTP or SSE after the tool set stabilizes

### Phase 2. Workspace automation

Add dashboard and widget mutation tools.

This is where VNIBB becomes more than a read-only market MCP.

### Phase 3. Admin and data ops MCP

Expose guarded tools for sync status, freshness, backfill, and Appwrite checks.

These should require stronger auth and ideally a separate admin server or permission layer.

### Phase 4. In-app user-facing assistant

Wire the same MCP tools into the web copilot so the in-app assistant and IDE agents share the same capabilities.

## Recommended first MVP for VNIBB

If the goal is high value with low risk, start here:

1. Build a small MCP server that wraps VNIBB backend endpoints, not raw `vnstock`.
2. Keep it read-only at first.
3. Expose 6 to 8 tools focused on symbol, sector, news, and financial analysis.
4. Add 2 to 3 resources for current workspace and screener context.
5. Use it first in IDE clients and internal workflows before exposing it in the app UI.

That path gives you fast feedback without creating permission or mutation complexity too early.

## Guardrails

### Data safety

- prefer VNIBB cached and normalized endpoints over raw provider calls
- avoid tools that trigger expensive fan-out by default
- limit date ranges and batch sizes
- expose freshness metadata in responses

### Auth and permissions

- separate public research tools from admin tools
- never expose secrets through resources or tool outputs
- require explicit auth for mutation and operations tools

### Product safety

- keep tool names narrow and action-oriented
- return structured JSON payloads with stable fields
- include `source`, `as_of`, and `freshness` where relevant
- document degraded/fallback responses clearly

## Example user flows

### Flow 1. Research analyst

User asks:

"Compare HPG, HSG, and NKG on valuation, margin trend, and price momentum."

Agent uses:

- `get_financial_summary`
- `get_price_history`
- `get_peer_comparison`

Then optionally:

- `create_dashboard`
- `add_widget`

### Flow 2. Workspace builder

User asks:

"Create a semiconductors watch dashboard and sync all widgets to FPT."

Agent uses:

- `create_dashboard`
- `add_widget`
- `set_sync_group`
- `save_layout`

### Flow 3. Ops triage

User asks:

"Why is the screener missing today?"

Agent uses:

- `check_data_freshness`
- `get_job_status`
- `inspect_pipeline_errors`
- `refresh_screener_cache`

## Recommendation

The best use of MCP in VNIBB is not as a separate novelty feature.

It should become the standard agent interface for three things:

- research queries
- workspace automation
- data operations

If implemented well, MCP can make VNIBB feel less like a dashboard with chat and more like an agent-operable research terminal.
