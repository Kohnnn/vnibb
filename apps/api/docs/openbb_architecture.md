# OpenBB V4 Platform Architecture

## Core Concepts
The OpenBB Platform (v4+) uses a hexagonal architecture where **Providers** (Data) and **Extensions** (logic/routes) are pluggable modules around a **Core**.

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
To align with this modularity, VNIBB will structure its backend as follows:

1.  **Core**: `backend/vnibb/core` (Auth, Database, Settings) - maps to `openbb_core`.
2.  **Providers**: `backend/vnibb/providers/vnstock` - maps to `openbb_providers`.
    *   This will contain specific `Fetcher` implementations for `vnstock`.
3.  **App/Routers**: `backend/vnibb/routers` - maps to `openbb_extensions`.
    *   `router.py` (Main entry point)
    *   `equity/router.py` (Equity commands)
    *   `screener/router.py` (Screener commands)

## Module Loading (Simplified)
Unlike the full OpenBB Platform which uses `entry_points` in `pyproject.toml` for discovery, VNIBB will explicitly import and mount routers in the main `FastAPI` app to keep complexity manageable while retaining the *structural* modularity.

```python
# backend/vnibb/main.py
from fastapi import FastAPI
from vnibb.routers.equity import router as equity_router

app = FastAPI()
app.include_router(equity_router)
```
