# AI Roadmap

This roadmap translates the OpenBB comparison into concrete VNIBB delivery batches.

## Goal

Turn VNIBB AI from a grounded answer layer into a workspace-native research operator.

OpenBB is still ahead in four workflow areas:

1. artifact outputs such as tables, charts, and richer generated views
2. widget-aware orchestration and dashboard actions
3. broader structured and unstructured data handling
4. user feedback loops and answer-quality telemetry

VNIBB is already strong in:

1. VNIBB database-first market grounding
2. validated source citations
3. Vietnam-specific equity context
4. browser-local provider flexibility
5. prompt-injection hardening and server-side answer validation

## Roadmap Principles

1. Keep AI VNIBB database-first and grounded by default
2. Prefer small deterministic backend tools over broad autonomous actions
3. Make AI outputs reusable in the dashboard, not just readable in chat
4. Add observability as features become more autonomous

## Shipped Foundation

These pieces are already in place:

- OpenRouter-backed active copilot path
- browser-local BYOK and OpenAI-compatible provider mode
- VNIBB database-first context with Postgres fallback
- structured output validation
- validated source catalog and evidence panels
- reasoning/status SSE events
- integrated VniAgent prompt library with backend default/shared prompt support
- OpenRouter model catalog-backed selection UX

## Stability Pass

Status: in progress

### Goal

Reduce avoidable complexity in VniAgent and improve answer quality and runtime reliability before adding more features.

### Focus

- simplify prompt/output behavior so models can answer more naturally
- reduce optional or noisy behaviors when they hurt reliability
- keep app-default runtime behavior globally consistent
- make the active global model clearly visible to users
- prefer VNIBB database wording in user-facing VniAgent surfaces
- keep the sidebar, widget, and analysis views answer-first with details collapsed by default

### Shipped in the current UX pass

- clearer VniAgent settings grouping into basics, connection, and data/behavior sections
- visible current-runtime summary in site settings so users can quickly see provider, mode, model, and data preference
- VniAgent sidebar runtime/context chips for symbol, tab, widget context, provider, mode, model, and data-source stance
- recent-session archive and restore flow in the main VniAgent sidebar so prior symbol/context threads are easier to resume

## Batch 1: Table Artifacts

Status: shipped MVP

### Why

This is the highest-value gap versus OpenBB. It turns AI from text output into reusable analytical objects.

### Scope

- add backend artifact payloads for ranked tables
- add frontend rendering for AI-generated tables inside copilot responses
- start with deterministic financial comparison and breadth tables

### MVP shipped

- inline comparison tables for multi-symbol comparison and ranking prompts
- sector breadth snapshot tables
- foreign flow leaderboard tables
- deterministic artifact generation from validated backend context
- inline artifact rendering in sidebar copilot, widget copilot, and AI analysis widget

### Remaining follow-up

- export artifact tables with chat exports
- add richer sorting and highlighting inside AI-generated tables
- add direct "create widget from artifact" flows

### Candidate artifact types

- peer comparison table
- valuation ranking table
- sector breadth summary table
- foreign flow leaderboard table

### Constraints

- artifacts must be derived from validated backend context, not free-form model JSON alone
- row and column limits must stay bounded

### Target files

- `apps/api/vnibb/services/llm_service.py`
- `apps/api/vnibb/api/v1/copilot.py`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/ui/AICopilot.tsx`
- `apps/web/src/components/widgets/AICopilotWidget.tsx`

## Batch 2: Chart Artifacts

Status: shipped MVP

### Why

OpenBB is visibly stronger when AI can generate a visual answer, not just describe one.

### Scope

- add structured chart payloads for a small approved chart set
- render inline chart artifacts in copilot responses

### MVP shipped

- normalized price trend line charts
- comparison quality/growth bar charts
- sector change overview charts
- foreign flow comparison charts
- inline chart rendering in sidebar copilot, widget copilot, and AI analysis widget

### Remaining follow-up

- richer chart controls and legend toggles
- allow artifact-to-widget promotion from AI output
- add chart export actions

### Candidate charts

- price trend with support/resistance overlay
- peer valuation bar chart
- sector breadth bar chart
- foreign net flow trend chart

### Constraints

- start with backend-approved chart schemas only
- no arbitrary code-generated chart configs

## Batch 3: Widget Actions

Status: shipped MVP

### Why

This is the biggest product-level difference between VNIBB today and OpenBB.

### Scope

- let AI suggest or trigger approved dashboard actions
- start with explicit allowlisted actions only

### MVP shipped

- deterministic action suggestions returned in the copilot SSE `done` event
- explicit confirmation panels before execution
- allowlisted actions for:
  - switching the linked global symbol
  - adding widgets to the current editable tab
- initial widget actions for:
  - `price_chart`
  - `comparison_analysis`
  - `market_breadth`
  - `foreign_trading`

### Remaining follow-up

- support direct symbol-aware widget seeding for compare widgets
- expand the allowlist to richer chart and table promotion actions

### Candidate actions

- change symbol in the current context
- add a comparison widget
- add a sector breadth widget
- add a valuation table widget
- add a trend chart widget

### Constraints

- no silent autonomous mutation of the dashboard
- require explicit user confirmation for write-like actions

## Batch 4: Feedback And Quality Loop

Status: shipped MVP

### Why

OpenBB benefits from explicit user feedback loops. VNIBB needs this before more autonomy is added.

### Scope

- thumbs up/down on assistant messages
- store provider, model, latency, used source IDs, reasoning events, and feedback outcome
- add review dashboards for AI quality analysis

### MVP shipped

- thumbs up/down feedback controls in sidebar copilot, widget copilot, and AI analysis widget
- backend feedback endpoint tied to response IDs
- response telemetry logging for:
  - provider
  - model
  - mode
  - latency
  - used source IDs
  - artifact IDs
  - action IDs
  - reasoning events
  - feedback outcome

### Remaining follow-up

- action-level success tracking refinement
- richer review dashboards and deeper aggregations on top of the durable telemetry store

### Metrics

- answer acceptance rate
- uncited factual answer rate
- source usage frequency
- provider/model failure rates

## Batch 5: Document Context

Status: shipped MVP

### Why

OpenBB handles unstructured data better. VNIBB should support annual reports, filings, and uploaded notes.

### Scope

- ingest PDF and markdown/text documents
- chunk documents with stable source IDs
- merge document citations into the same evidence system

### MVP shipped

- PDF, TXT, MD, and JSON uploads in the sidebar VniAgent flow
- document parsing into temporary chat context
- document context included alongside VNIBB market context in requests

### Remaining follow-up

- persistent document libraries
- document citations with page-level references
- admin or user-managed document stores

### Candidate sources

- annual reports
- AGM docs
- investor presentations
- internal research notes

## Batch 6: Safe Structured Querying

### Why

OpenBB’s structured-data handling is a real advantage, but VNIBB should avoid arbitrary SQL.

### Scope

- expose curated AI query surfaces only
- prefer `ai_*` views and backend query helpers
- optionally add constrained text-to-query translation later

### Constraints

- read-only only
- strict row limits
- no unrestricted joins
- no direct execution of user-provided SQL

## Priority Order

1. Batch 1: Table Artifacts
2. Batch 2: Chart Artifacts
3. Batch 3: Widget Actions
4. Batch 4: Feedback And Quality Loop
5. Batch 5: Document Context
6. Batch 6: Safe Structured Querying

## Suggested Shipping Rhythm

### Sprint A

- table artifacts
- initial artifact renderer
- telemetry for artifact usage

### Sprint B

- chart artifacts
- chart renderer
- export and evidence integration for artifacts

### Sprint C

- widget action suggestions
- explicit confirmation UX
- source-linked jump or add-widget flows

### Sprint D

- feedback loop
- AI quality logging
- internal review dashboard

## Open Questions

1. Should artifact creation be allowed in all AI surfaces or only the sidebar copilot first?
2. Should widget actions remain suggestion-only initially, or include one-click execution?
3. Should uploaded document context be browser-only at first or stored server-side?
4. Which artifact type matters most to your workflow: peer tables, charts, or generated memo-style reports?
