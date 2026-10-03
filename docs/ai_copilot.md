# VniAgent

This document describes the current VNIBB VniAgent architecture and the OpenBB patterns we deliberately borrowed.

For the phased delivery plan, see `docs/ai_roadmap.md`.

## Current State

VNIBB does not use Gemini in the active copilot path anymore.

The active copilot flow is:

1. Frontend sends widget-aware chat context to `POST /api/v1/copilot/chat/stream`
2. Backend builds VNIBB market context and prefers the dedicated `vnibb-mcp` read path when `VNIBB_MCP_URL` is configured
3. `vnibb-mcp` serves curated database-backed reads for selected VniAgent context requests
4. If MCP is unavailable, backend falls back to direct database-stack context assembly
5. Backend sends a context-aware prompt to the configured provider
6. Model answers naturally in Markdown
7. Backend validates any cited source IDs against `source_catalog`
8. Backend emits SSE events for:
   - reasoning/status
   - markdown chunks
   - normalized evidence metadata on `done`
   - inline table artifacts on `done`
   - inline chart artifacts on `done`
   - suggested dashboard actions on `done`
   - response metadata on `done`
9. Frontend renders:
   - answer body
   - inline table artifacts
   - inline chart artifacts
   - confirmed dashboard actions
   - thumbs up/down feedback controls
   - collapsible evidence panel
   - process/reasoning log

## Current Runtime Diagram

```text
VniAgent sidebar / widget copilot
  -> POST /api/v1/copilot/chat/stream
  -> AIContextService in apps/api
  -> vnibb-mcp via VNIBB_MCP_URL for selected database-backed reads
  -> the database stack
  -> validated source_catalog + runtime context
  -> model provider
  -> SSE response back to VniAgent UI
```

## OpenBB References Reviewed

The following OpenBB examples were reviewed from `OpenBB-finance/agents-for-openbb`:

- `31-vanilla-agent-reasoning-steps`
- `32-vanilla-agent-raw-widget-data-citations`
- `33-vanilla-agent-charts`
- `34-vanilla-agent-tables`
- `39-vanilla-agent-html-artifacts`

We also reviewed the public OpenBB Copilot and AI SDK docs.

## OpenBB Patterns We Borrowed

### 1. Reasoning/status events

OpenBB streams explicit reasoning/status steps instead of only final text.

VNIBB now does the same with deterministic backend-generated SSE events such as:

- building runtime context
- requesting the structured model response
- validating citations

These are operational steps, not hidden model chain-of-thought.

### 2. Evidence-first answers

OpenBB makes citations visible and tied to the data used.

VNIBB now uses:

- a server-generated `source_catalog`
- validated `used_source_ids`
- per-message evidence metadata returned on the SSE `done` event
- a frontend `CopilotEvidencePanel`
- widget-linked evidence actions such as `Jump to widget` and `Add widget`

### 3. Context-aware AI

OpenBB agents use widget/dashboard context heavily.

VNIBB mirrors that by sending:

- current symbol
- active tab
- widget snapshots
- VNIBB database-first server context

Browser widget data remains lower-priority than backend data.

## What VNIBB Implements Today

### Backend

- OpenRouter as the app-managed default provider
- browser-local BYOK overrides
- optional OpenAI-compatible browser-local provider mode
- OpenRouter model catalog endpoint for settings-driven model selection
- OpenRouter free-model detection and admin runtime status checks
- backend prompt library service with default and shared prompt support
- shared prompt versioning and history
- VNIBB MCP-first context assembly for selected database-backed reads, with direct database-stack fallback, for:
  - stock profile
  - prices
  - ratios
  - financial statements
  - news
  - foreign trading
  - order flow
  - insider deals
  - company events
  - dividends
  - market indices
  - sector breadth
- validated source references such as `VNM-PRICES` and `MKT-INDICES`
- backend-provided widget targets attached to sources and artifacts
- structured output validation before the UI sees the answer
- deterministic table artifacts derived from validated runtime context for comparison, sector breadth, and foreign flow prompts
- deterministic chart artifacts derived from validated runtime context for price trends, comparison metrics, sector breadth, and foreign flow prompts
- deterministic action suggestions for switching the linked symbol and adding allowlisted widgets after explicit user confirmation
- response-level telemetry with response IDs, provider/model metadata, latency, source IDs, artifact IDs, action IDs, and recorded feedback outcome

### Frontend

- browser-local AI settings
- public runtime-model visibility for app-default mode
- OpenRouter model suggestions and searchable model selection
- OpenRouter free-model helper link under model selection
- current-runtime summary card in site settings for provider, mode, model, and database preference
- integrated VniAgent prompt library in the main agent panel
- admin-managed shared prompt library editing
- admin-managed shared prompt version history
- admin telemetry review filters and summary metrics
- authenticated SSE chat transport
- inline table artifact rendering in copilot surfaces
- inline chart artifact rendering in copilot surfaces
- action confirmation panels in copilot surfaces
- thumbs up/down feedback bars in copilot surfaces
- thumbs-down reason categories and optional feedback notes
- evidence panel in sidebar copilot, widget copilot, and AI analysis widget
- widget-linked evidence actions and artifact-to-widget promotion
- reasoning/status display while the answer is being prepared
- document/PDF attachment support in the main VniAgent sidebar
- advanced artifacts/actions/evidence are collapsed behind per-message details in the main sidebar flow
- symbol/context-scoped recent-session archive and restore flow in the main VniAgent sidebar

Current telemetry note:

- recent AI telemetry review is available through the admin review panel
- AI telemetry now persists durably through the application metadata store across restarts
- admin review now supports filters and summary metrics for acceptance, latency, and artifact ratings

Current document context note:

- VniAgent supports PDF, TXT, MD, and JSON uploads in the sidebar flow
- uploaded documents are parsed into temporary chat context and sent alongside VNIBB market context
- PDF support requires `pypdf` and multipart upload support in the backend runtime

Current stability note:

- VniAgent currently favors freer Markdown responses instead of forcing a rigid JSON answer contract
- optional features remain available, but the current focus is answer quality and runtime reliability
- low-value runtime toggles were moved out of the main sidebar to keep the chat surface cleaner
- advanced message panels in sidebar, widget, and analysis views are collapsed behind `Details`
- prompt starters are trimmed down to the strongest few per context
- document attach is now behind a secondary tools menu in the sidebar composer
- the sidebar header now makes the active symbol, tab, widget context, provider, mode, model, and VNIBB database-first stance visible at a glance
- when `VNIBB_MCP_URL` is configured, selected server-side VniAgent runtime reads now flow through the dedicated read-only VNIBB MCP instead of hitting the database stack directly
- if the MCP companion is unavailable, the backend falls back to direct database-stack context reads so chat does not hard-fail on transport issues

## What We Explicitly Did Not Copy

VNIBB does not currently adopt the full OpenBB Workspace agent stack.

We are not using:

- the `openbb-ai` SDK
- OpenBB widget orchestration callbacks
- OpenBB MCP tool execution flow
- OpenBB chart/table artifact protocol

Those patterns are good references, but VNIBB has its own backend, widget system, and data stack.

## SSE Event Contract

The copilot stream currently supports these event shapes:

- `{"reasoning": {"eventType": "INFO|SUCCESS|WARNING|ERROR", "message": "...", "details": {...}}}`
- `{"chunk": "markdown text"}`
- `{"done": true, "usedSourceIds": [...], "sources": [...], "artifacts": [...]}`
- `{"done": true, ..., "actions": [...]}`
- `{"done": true, ..., "responseMeta": {...}}`
- `{"done": true, ..., "followUps": [{"id": "...", "label": "...", "prompt": "...", "sourceIds": [...]}]}`
- `{"error": "..."}`

## Next OpenBB-Inspired Steps

The strongest remaining OpenBB-style improvements are:

1. HTML artifacts for richer AI-generated reports
2. Richer review dashboards and filters for AI quality analysis
3. Document-native context ingestion
4. More advanced tool orchestration beyond the current allowlisted actions
5. Richer feedback capture such as per-artifact ratings and workspace-level review actions
6. Dynamic follow-up suggestions ship as `followUps`: grounded, deterministic, and derived from the response context rather than model prose. The remaining gap is the reverse direction — user-authored skills, deferred until instruction-trust semantics exist.

## Widget capability context

The workspace widget catalogue in `apps/web/src/data/widgetDefinitions.ts` is the source of truth for widget capabilities consumed by VniAgent. Each catalogue widget derives a `WidgetCapability` with catalogue name/description/category plus an explicit VniAgent record:

- `coverage`: `mapped` only for widgets wired to a real server evidence kind; every other catalogue widget is `unknown`.
- `scope`: `symbol` or `market` for mapped widgets; `unknown` otherwise, with no inferred coverage.
- `evidenceKinds`: the server evidence kinds (`company_profile`, `price_history`, `financial_ratios`, `income_statement`, `balance_sheet`, `cash_flow`, `company_news`, `foreign_trading`, `order_flow`, `insider_deals`, `company_events`, `dividends`, `market_indices`, `sector_breadth`) actually mapped today.
- `configurationInputs`: reviewed, typed inputs (currently the price-chart period and display mode) validated with `validateWidgetCapabilityConfiguration`; invalid or unreviewed values are excluded rather than passed through.
- `evidenceLimits`: explicit unknowns (freshness, rights, completeness) plus per-widget limits.

`buildVniAgentWorkspaceContext` in `apps/web/src/lib/vniagentWorkspace.ts` builds the existing copilot request context from this contract: the widget's resolved ticker scopes symbol evidence, a prefetched snapshot for a different ticker is dropped, market-scoped widgets never inherit a company ticker or company snapshot, and capability data is delivered under `widgetPayload.widgetCapabilities`. No runtime plugin loader and no browser-supplied capability fields are trusted.

Every widget exposes **Requirements & limitations** from its action menu (`WidgetCapabilityPanel`), showing scope, current ticker, VniAgent coverage, reviewed configuration inputs, and evidence limits without claiming unsupported parameters.

## Reviewed curated workflows

Research starters reuse the existing dashboard templates and VniAgent prompt library. Each code-owned workflow has a stable ID, integer revision, supported scope, mandatory evidence kinds and visible limits. The template confirmation and prompt library show these requirements and the current symbol before selection. The composer keeps the selected workflow separate from editable question text; local and admin-shared prompt text does not become authoritative workflow instructions.

`GET /api/v1/copilot/prompts` returns flat `revision`, `scope`, `requiredEvidenceKinds` and `limits` metadata for reviewed system prompts. A stream request selects a workflow by identity only:

```json
{"message":"Review the risks","context":{"symbol":"VNM"},"workflow":{"id":"financial-summary","revision":1,"symbol":"VNM"}}
```

The server rejects unknown IDs (404), stale revisions (409), unsupported scope or mismatched current symbols (422), and instruction-body fields in the workflow selection (422). After building trusted runtime context, it resolves the code-owned instructions and selects only nonblank source IDs with matching evidence kind and scope. Another company's statements cannot satisfy the current symbol's mandatory requirements; market requirements only use market-scoped evidence. Missing kinds and unknown as-of dates are explicit limitations. Browser snapshots and user instruction bodies never establish evidence availability.

Peer comparison reuses the authorized frozen Matrix selection and the current sector Research Playbook definition, questions and accounting limits. It does not define a second comparison playbook or silently compare live browser widgets. Attach a frozen Matrix selection before sending the peer workflow. Selected Matrix cells are not a whole-market universe and do not prove comparability.

To revise a reviewed workflow, edit `DEFAULT_PROMPTS` in `ai_prompt_library_service.py` and increment its revision; update the matching starter identity/disclosure in `researchStarters.ts`. Workflow instructions are code-reviewed, not user-authored executable skills. The public stream boundary tests cover version rejection, missing/complete evidence, cross-symbol scope and instruction injection; prompt-library tests cover truthful selection metadata and local/offline trust boundaries.

