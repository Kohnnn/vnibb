# AI Copilot

This document describes the current VNIBB AI copilot architecture and the OpenBB patterns we deliberately borrowed.

For the phased delivery plan, see `docs/ai_roadmap.md`.

## Current State

VNIBB does not use Gemini in the active copilot path anymore.

The active copilot flow is:

1. Frontend sends widget-aware chat context to `POST /api/v1/copilot/chat/stream`
2. Backend builds Appwrite-first market context with Postgres fallback
3. Backend sends a structured prompt to the configured provider
4. Model returns JSON with:
   - `answer_markdown`
   - `used_source_ids`
5. Backend validates cited source IDs against `source_catalog`
6. Backend emits SSE events for:
   - reasoning/status
   - markdown chunks
   - normalized evidence metadata on `done`
   - inline table artifacts on `done`
   - inline chart artifacts on `done`
7. Frontend renders:
   - answer body
   - inline table artifacts
   - inline chart artifacts
   - collapsible evidence panel
   - process/reasoning log

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

### 3. Context-aware AI

OpenBB agents use widget/dashboard context heavily.

VNIBB mirrors that by sending:

- current symbol
- active tab
- widget snapshots
- Appwrite-first server context

Browser widget data remains lower-priority than backend data.

## What VNIBB Implements Today

### Backend

- OpenRouter as the app-managed default provider
- browser-local BYOK overrides
- optional OpenAI-compatible browser-local provider mode
- Appwrite-first context assembly for:
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
- structured output validation before the UI sees the answer
- deterministic table artifacts derived from validated runtime context for comparison, sector breadth, and foreign flow prompts
- deterministic chart artifacts derived from validated runtime context for price trends, comparison metrics, sector breadth, and foreign flow prompts

### Frontend

- browser-local AI settings
- authenticated SSE chat transport
- inline table artifact rendering in copilot surfaces
- inline chart artifact rendering in copilot surfaces
- evidence panel in sidebar copilot, widget copilot, and AI analysis widget
- reasoning/status display while the answer is being prepared

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
- `{"error": "..."}`

## Next OpenBB-Inspired Steps

The strongest remaining OpenBB-style improvements are:

1. HTML artifacts for richer AI-generated reports
2. Source-usage logging for answer quality review
3. Optional tool-call orchestration for controlled backend tools
4. User feedback and quality loops
5. Document-native context ingestion
