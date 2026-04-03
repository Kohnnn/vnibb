# OpenBB Notes For VNIBB

This document started as a rough architecture note about OpenBB v4 patterns. It now serves two purposes:

1. explain the OpenBB architectural ideas that influenced VNIBB
2. document the OpenBB AI-agent patterns we intentionally reused

## Core Concepts

The OpenBB Platform (v4+) uses a hexagonal architecture where **Providers** (data) and **Extensions** (logic/routes) are pluggable modules around a **Core**.

### 1. The Router Pattern (`openbb_core.app.router.Router`)
Each functional area (e.g., `equity`, `crypto`) is an "Extension" that exposes a `Router`.
The `Router` wraps FastAPI's `APIRouter` but adds a custom `@command` decorator.

```python
from openbb_core.app.router import Router
from openbb_core.app.model.obbject import OBBject

router = Router(prefix="/equity")

@router.command(model="EquityHistorical")
def historical(
    symbol: str, 
    provider: str | None = None
) -> OBBject:
    """Get historical prices."""
    return OBBject(results=...)
```

### 2. The Provider Pattern
Providers implement the data fetching logic. A provider must implement the `ProviderInterface`.

#### The Fetcher Interface
Most data comes via "Fetchers". A Fetcher handles the ETL (Extract, Transform, Load) pipeline for a specific data endpoint.

```python
class BaseFetcher(ABC, Generic[QueryT, DataT]):
    @staticmethod
    def transform_query(params: QueryT) -> dict: ...
    @staticmethod
    async def extract_data(query: dict, credentials: dict) -> list[dict]: ...
    @staticmethod
    def transform_data(query: QueryT, data: list[dict]) -> list[DataT]: ...
```

### 3. VNIBB Implementation Strategy

VNIBB keeps the same broad separation of concerns, but in its actual repo layout:

1. **Core**: `apps/api/vnibb/core`
2. **Providers**: `apps/api/vnibb/providers`
3. **Routers / API**: `apps/api/vnibb/api/v1`
4. **Services**: `apps/api/vnibb/services`

## Module Loading (Simplified)

Unlike the full OpenBB Platform which uses `entry_points` in `pyproject.toml` for discovery, VNIBB explicitly imports and mounts routers in the main `FastAPI` app to keep complexity manageable while retaining the structural modularity.

```python
# apps/api/vnibb/api/main.py
from fastapi import FastAPI
from vnibb.api.v1.router import api_router

app = FastAPI()
app.include_router(api_router)
```

## OpenBB AI Agent Patterns We Reused

The repo `OpenBB-finance/agents-for-openbb` is the most relevant OpenBB reference for VNIBB AI work.

Examples reviewed:

- `31-vanilla-agent-reasoning-steps`
- `32-vanilla-agent-raw-widget-data-citations`
- `33-vanilla-agent-charts`
- `34-vanilla-agent-tables`
- `39-vanilla-agent-html-artifacts`

Patterns VNIBB now implements:

1. **Reasoning/status SSE events**
   - VNIBB now emits deterministic backend status steps like context build and citation validation.
2. **Grounded source attribution**
   - VNIBB now generates a `source_catalog`, validates `used_source_ids`, and exposes evidence metadata to the UI.
3. **Context-aware copilot behavior**
   - VNIBB uses active symbol, active tab, widget snapshots, and Appwrite-first backend context.
4. **Table artifact responses**
   - VNIBB now returns deterministic comparison and ranking tables derived from validated runtime context.
5. **Chart artifact responses**
   - VNIBB now returns deterministic chart payloads for price trends, comparison metrics, sector breadth, and foreign flow views.
6. **Allowlisted dashboard actions**
   - VNIBB now suggests explicit symbol-switch and add-widget actions that require user confirmation before execution.
7. **Feedback and telemetry loop**
   - VNIBB now records response-level telemetry and user thumbs feedback tied to concrete response IDs.

Patterns we have not implemented yet:

1. HTML artifact responses
2. full tool-orchestration callbacks in the OpenBB style

For the current VNIBB AI implementation details, see `docs/ai_copilot.md`.
