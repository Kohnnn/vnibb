# Deployment and Operations

## Current production shape

The current operational picture reflected in recent project context is:

- frontend deployed on Vercel
- backend deployed on OCI
- read-only VNIBB MCP companion deployed alongside the backend on OCI for VniAgent and remote clients
- Supabase (PostgreSQL) serving as the primary durable database and dashboard persistence layer this month, with Appwrite used only as a read fallback where still helpful
- Supabase auth serving as the active auth provider this month
- Appwrite retained as a read-only legacy fallback because org-level writes are blocked with `limit_databases_writes_exceeded`
- Redis used for cache and resilience behavior

This is a temporary earnings-season operating mode for the current month. If Appwrite quota resets cleanly next month, re-enable it only through a controlled projection/backfill path instead of switching production back to Appwrite-first by default.

## Why operations became a major project theme

VNIBB depends on upstream market data providers that are not perfectly stable. That means operational quality is part of the product, not just infrastructure work.

The deployment and ops work has focused on:

- keeping the app alive during provider instability
- reducing noisy 502 and timeout behavior
- preventing brittle startup failures
- tightening cache behavior for expensive market endpoints
- making production debugging faster with better logs and health checks

## Runtime topology

At a high level, production looks like:

1. Vercel serves the frontend
2. OCI hosts the backend runtime and the dedicated `vnibb-mcp` sidecar
3. the backend exposes HTTP and WebSocket surfaces
4. the `vnibb-mcp` sidecar exposes the read-only MCP HTTP surface for VniAgent and remote clients
5. Supabase/Postgres and cache services back persistence and runtime state; Appwrite remains read-only legacy fallback only
6. upstream market providers feed the service layer

```text
Vercel frontend
  -> OCI Caddy
     -> FastAPI api service (:8000)
     -> vnibb-mcp service (:8001)

VniAgent server context path
  -> apps/api
  -> VNIBB_MCP_URL
  -> vnibb-mcp
  -> Supabase/Postgres primary
  -> Appwrite read-only fallback
```

## Backend Tech Stack

### Core Framework

| Layer | Technology | Purpose |
|-------|------------|---------|
| **API Framework** | FastAPI 0.110+ | REST API with async/await, Pydantic validation |
| **ASGI Server** | Uvicorn (standard) | Production ASGI server with Gunicorn workers |
| **Python** | 3.11+ | Runtime with type hints throughout |

### Data Processing

| Layer | Technology | Purpose |
|-------|------------|---------|
| **DataFrames** | Pandas 1.5+ | Financial data manipulation |
| **Excel/Sheets** | openpyxl 3.1+ | Excel report generation |
| **Numeric** | NumPy 1.24+ | Array operations for calculations |

### Data Providers

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Primary API** | VNStock 3.5+ | Vietnam stock data (KBS baseline) |
| **AI Assist** | VNAI 2.4+ | AI-powered analysis hooks |
| **Premium Data** | vnstock_data, vnstock_ta, vnstock_news, vnstock_pipeline | Optional premium VNStock modules |

### Database & Persistence

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Primary Store** | Appwrite | Document DB, auth, 26 collections |
| **SQL Fallback** | PostgreSQL 16 (Supabase) | Seeding, population scripts |
| **Async DB** | SQLAlchemy 2.0+ / asyncpg | Async ORM with connection pooling |
| **Migrations** | Alembic 1.13+ | Schema migrations |
| **Cache** | Redis 5.0+ | Multi-tier cache (Redis + memory fallback) |
| **Sync Driver** | psycopg2-binary | PostgreSQL sync operations |

### HTTP & Networking

| Layer | Technology | Purpose |
|-------|------------|---------|
| **HTTP Client** | httpx 0.26+ | Async HTTP with retry logic |
| **Async HTTP** | aiohttp 3.9+ | Streaming and WebSocket clients |
| **MCP** | python-mcp 1.0+ | Model Context Protocol server |
| **File Upload** | python-multipart | Multipart form handling |
| **PDF Parsing** | pypdf 5.9+ | Financial document extraction |

### WebSocket & Real-time

| Layer | Technology | Purpose |
|-------|------------|---------|
| **WebSocket** | websockets 12.0+ | Real-time price streaming |
| **Protocol** | Socket.IO or native WS | Widget real-time updates |

### Scraping & Fallback

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Browser Automation** | Playwright 1.41+ | Headless browser for JS-rendered pages |
| **HTML Parsing** | BeautifulSoup 4.12+ / lxml 5.0+ | HTML/XML parsing |

### Validation & Settings

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Data Validation** | Pydantic 2.5+ | Request/response models, settings |
| **Settings** | pydantic-settings 2.1+ | Environment-based config |
| **Env Files** | python-dotenv 1.0+ | .env file loading |
| **Timezone** | pytz 2023.3 | Timezone handling |

### Utilities

| Layer | Technology | Purpose |
|-------|------------|---------|
| **JSON** | orjson 3.9+ | Fast JSON serialization |
| **Scheduling** | APScheduler | Scheduled sync jobs |
| **Rate Limiting** | slowapi | Per-client rate limiting |
| **Logging** | structlog / logging | Structured JSON logging |

### Frontend Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Framework** | Next.js 16 + React 19 | App Router, Server Components |
| **Language** | TypeScript 5 (strict) | Type-safe frontend |
| **Styling** | Tailwind CSS 4 | Utility-first CSS |
| **State/Fetch** | TanStack Query 5 | Server state management |
| **Charts** | Recharts 3.6 / lightweight-charts 4.2 | Financial charts |
| **Grid Layout** | react-grid-layout 2.2 | Dashboard widget layout |
| **Auth** | @supabase/ssr + Appwrite | Session management |
| **Icons** | lucide-react | Icon library |
| **Animations** | framer-motion 12 | UI animations |
| **Package Manager** | pnpm 9.15 | Monorepo package management |
| **Monorepo** | Turbo 2 | Build caching, task orchestration |
| **Deploy** | Vercel | Frontend hosting |

## Data Flow: Raw Data to Widgets

The complete data pipeline from raw provider data to widget display:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RAW DATA SOURCES                                    │
│                                                                              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐  │
│  │  VNStock API    │    │  Web Scrapers    │    │  Exchange APIs (KBS,   │  │
│  │  (Primary)      │    │  (Fallback)      │    │  DNSE, VCI, Cafef)    │  │
│  └────────┬────────┘    └────────┬─────────┘    └──────────┬─────────────┘  │
│           │                      │                        │                 │
└───────────┼──────────────────────┼────────────────────────┼─────────────────┘
            │                      │                        │
            ▼                      ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND INGESTION LAYER                            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        sync_all_data.py                                  │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │ │
│  │  │ VNStock      │ │ Scraper      │ │ Price Board  │ │ Exchange     │   │ │
│  │  │ Fetcher      │ │ Fetcher      │ │ Fetcher      │ │ Direct       │   │ │
│  │  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘   │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼───────────┘ │
│            │                │                │                │               │
│            ▼                ▼                ▼                ▼               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    TRANSFORMATION LAYER                                   │ │
│  │  • Normalize field names (symbol -> symbol_q)                           │ │
│  │  • Convert periods (2024Q1 -> FY2024/Q1)                              │ │
│  │  • Calculate TTM (Trailing Twelve Months)                              │ │
│  │  • Compute derived ratios (ROE, ROA, EV/EBITDA)                        │ │
│  │  • Handle missing data / provider quirks                               │ │
│  └────────────────────────────────┬────────────────────────────────────────┘ │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STORAGE LAYER                                      │
│                                                                              │
│  ┌─────────────────────────┐   ┌─────────────────────┐   ┌─────────────────┐ │
│  │      Appwrite           │   │   PostgreSQL         │   │     Redis       │ │
│  │   (Primary Store)       │   │   (Fallback/Seed)   │   │   (Cache)       │ │
│  │                         │   │                     │   │                 │ │
│  │  • 26 Collections       │   │  • stocks            │   │  • API cache    │ │
│  │  • stocks               │   │  • stock_prices      │   │  • Session      │ │
│  │  • stock_prices         │   │  • financial_*      │   │  • Rate limits  │ │
│  │  • financial_*         │   │  • foreign_trading   │   │  • WebSocket    │ │
│  │  • company_*           │   │  • ...               │   │    state        │ │
│  │  • market_*            │   │                     │   │                 │ │
│  │                         │   │                     │   │                 │ │
│  │  TTL: 30s - 24h        │   │  TTL: Permanent     │   │  TTL: 30s-24h   │ │
│  │  publicRead permission │   │  Private             │   │  Auto-fallback  │ │
│  └─────────────────────────┘   └─────────────────────┘   └─────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API SERVING LAYER (FastAPI)                         │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                          ROUTERS                                         │ │
│  │  /equity/{symbol}/*  │  /market/*  │  /screener  │  /news  │  /ws/*  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│  ┌─────────────────────────────────┴───────────────────────────────────────┐ │
│  │                          SERVICE LAYER                                   │ │
│  │                                                                           │ │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐    │ │
│  │  │ financial_     │  │ market_         │  │ screener_               │    │ │
│  │  │ service.py     │  │ service.py      │  │ service.py              │    │ │
│  │  │                │  │                 │  │                         │    │ │
│  │  │ • get_ratios() │  │ • get_indices()│  │ • get_snapshots()       │    │ │
│  │  │ • TTM calc     │  │ • top_movers() │  │ • apply_filters()       │    │ │
│  │  │ • period_norm  │  │ • sectors()    │  │ • compute_metrics()     │    │ │
│  │  └───────┬────────┘  └──────┬─────────┘  └────────────┬────────────┘    │ │
│  └──────────┼───────────────────┼────────────────────────┼─────────────────┘ │
│             │                   │                        │                   │
│             ▼                   ▼                        ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                     FALLBACK RESOLUTION CHAIN                            │ │
│  │                                                                           │ │
│  │    1. Redis Cache (TTL-aware, returns immediately if hit)                │ │
│  │         │                                                               │ │
│  │         ▼ (miss)                                                        │ │
│  │    2. VNStock API (primary provider)                                    │ │
│  │         │                                                               │ │
│  │         ▼ (fail)                                                        │ │
│  │    3. Scraper Fallback (cafef/cophieu68)                                │ │
│  │         │                                                               │ │
│  │         ▼ (fail)                                                        │ │
│  │    4. Appwrite (persisted document store)                                │ │
│  │         │                                                               │ │
│  │         ▼ (fail)                                                        │ │
│  │    5. PostgreSQL (Supabase seed source)                                  │ │
│  │         │                                                               │ │
│  │         ▼ (fail)                                                        │ │
│  │    6. Stale Cache (if available)                                        │ │
│  │         │                                                               │ │
│  │         ▼ (all fail)                                                    │ │
│  │    7. DataNotFoundError → 404 response                                  │ │
│  │                                                                           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CACHE CONTROL                                      │
│                                                                              │
│  Response headers by endpoint type:                                          │
│  ┌────────────────────────────────────┬────────────────────────────────────┐│
│  │ Endpoint Type                      │ Cache Header                        ││
│  ├────────────────────────────────────┼────────────────────────────────────┤│
│  │ /health, /equity/*/quote           │ no-store, max-age=0                ││
│  │ /screener, /sectors, /historical    │ public, max-age=30, stale-while-   ││
│  │                                    │   revalidate=90                    ││
│  │ /profile, /ratios, /financials     │ public, max-age=300, stale-while-  ││
│  │                                    │   revalidate=1800                  ││
│  └────────────────────────────────────┴────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND WIDGET LAYER                              │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                       TanStack Query                                     │ │
│  │  queryKey: ['financialRatios', 'VNM', 'FY']                             │ │
│  │  staleTime: 60 * 60 * 1000 (1 hour)                                    │ │
│  │  cacheTime: 5 * 60 * 1000 (5 min)                                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│  ┌─────────────────────────────────┴───────────────────────────────────────┐ │
│  │                    WIDGET COMPONENTS                                     │ │
│  │                                                                           │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │ │
│  │  │ FinancialRatios │  │ PriceChart      │  │ ScreenerWidget  │         │ │
│  │  │ Widget          │  │ Widget          │  │                 │         │ │
│  │  │                 │  │                 │  │                 │         │ │
│  │  │ fetches:        │  │ fetches:        │  │ fetches:        │         │ │
│  │  │ /equity/{sym}   │  │ /equity/{sym}   │  │ /screener       │         │ │
│  │  │ /ratios         │  │ /historical     │  │                 │         │ │
│  │  │                 │  │                 │  │                 │         │ │
│  │  │ displays:       │  │ displays:       │  │ displays:       │         │ │
│  │  │ P/E, P/B, ROE   │  │ OHLCV candle    │  │ filterable      │         │ │
│  │  │ Net margin      │  │ volume bars     │  │ stock table      │         │ │
│  │  │ Debt/Equity     │  │ indicators      │  │ with metrics    │         │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │ │
│  │                                                                           │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │ │
│  │  │ MarketOverview  │  │ NewsWidget      │  │ OrderBookWidget │         │ │
│  │  │ Widget          │  │                 │  │                 │         │ │
│  │  │                 │  │ fetches:        │  │ fetches:        │         │ │
│  │  │ fetches:        │  │ /news           │  │ /market/orderbook│         │ │
│  │  │ /market/indices │  │ /equity/{sym}   │  │ /market/depth    │         │ │
│  │  │ /market/sectors│  │ /news           │  │                 │         │ │
│  │  │                 │  │                 │  │                 │         │ │
│  │  │ displays:       │  │ displays:       │  │ displays:       │         │ │
│  │  │ VN30, HNX idx   │  │ news feed with │  │ bid/ask depth   │         │ │
│  │  │ sector heatmap  │  │ RS, price      │  │ levels 1-3     │         │ │
│  │  │ top gainers     │  │ sentiment      │  │ volume at price │         │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Widget → Data Mapping

| Widget | API Endpoint | Appwrite Collection | Data Flow |
|--------|-------------|---------------------|-----------|
| `FinancialRatiosWidget` | `GET /equity/{symbol}/ratios` | `financial_ratios` | Appwrite → API → Widget |
| `IncomeStatementWidget` | `GET /equity/{symbol}/income-statement` | `income_statements` | Appwrite → API → Widget |
| `BalanceSheetWidget` | `GET /equity/{symbol}/balance-sheet` | `balance_sheets` | Appwrite → API → Widget |
| `CashFlowWidget` | `GET /equity/{symbol}/cash-flow` | `cash_flows` | Appwrite → API → Widget |
| `PriceChartWidget` | `GET /equity/{symbol}/historical` | `stock_prices` | Appwrite → API → Widget |
| `ScreenerWidget` | `GET /screener` | `screener_snapshots` | Appwrite → API → Widget |
| `MarketOverviewWidget` | `GET /market/indices` | `stock_indices` | Appwrite → API → Widget |
| `ForeignTradingWidget` | `GET /equity/{symbol}/foreign-trading` | `foreign_trading` | Appwrite → API → Widget |
| `CompanyNewsWidget` | `GET /equity/{symbol}/news` | `company_news` | Appwrite → API → Widget |
| `OrderBookWidget` | `GET /market/orderbook/{symbol}` | `orderbook_snapshots` | Appwrite → API → Widget |
| `DividendWidget` | `GET /equity/{symbol}/dividends` | `dividends` | Appwrite → API → Widget |
| `InsiderDealsWidget` | `GET /equity/{symbol}/insider-deals` | `insider_deals` | Appwrite → API → Widget |
| `SectorPerformanceWidget` | `GET /market/sector-performance` | `sector_performance` | Appwrite → API → Widget |

## Important operational lessons already learned

### 1. Provider instability is normal

The project has had to harden around:

- DNS instability
- slow upstreams
- incomplete payloads
- provider-specific schema oddities

Because of this, VNIBB relies on:

- source fallback ordering
- endpoint cache tuning
- more defensive transformations
- stronger timeout and retry behavior

### 2. Deployment bugs often present as product bugs

A broken WebSocket path, bad CORS config, stale env setup, or over-eager health check can look like a frontend feature failure even when the core code is correct.

### 3. Infrastructure migration is part of product evolution

The project's history includes:

- early Zeabur and Supabase deployment troubleshooting
- security and runtime hardening
- OCI adoption with staged mitigation planning
- migration toward a more controlled backend environment

## Local validation before deploy

From `vnibb/`:

```bash
pnpm run ci:gate
```

This is the best local confidence check because it runs the real sequence used by the repo's CI gate.

## Operational health checks

At minimum, verify:

- frontend loads the dashboard shell
- backend health endpoints respond
- key market endpoints return non-empty data
- WebSocket price path resolves correctly
- symbol-switching flows do not leave widgets in a permanent loading state

## Reliability-focused commands

From `vnibb/`:

```bash
pnpm run gate:no502
pnpm run gate:widgets:strict
```

These are useful when validating service hardening or widget runtime resilience.

## CI source of truth

Primary files:

- `vnibb/.github/workflows/ci.yml`
- `vnibb/scripts/ci-gate.mjs`

The CI gate currently checks:

- frontend lint
- frontend build
- frontend Jest tests
- backend compile smoke check
- backend pytest

## OCI workstream summary

The OCI documentation in `.agent/OCI/` shows a staged operational mindset:

- harden host first
- deploy runtime second
- introduce load balancer after app stability
- add WAF only after baseline traffic is healthy
- preserve rollback paths while moving layers one by one

That staged method is worth keeping. It prevented the project from mixing too many risky changes into one deployment step.

## What operators should watch most closely

- slow warnings on market aggregation endpoints
- cache TTL regressions that increase upstream pressure
- provider-specific fallback drift
- WebSocket reconnect noise after backend restarts
- frontend surfaces that degrade into empty or misleading placeholders

## Practical guidance for future changes

- Treat logs and smoke probes as first-class evidence.
- Test multiple symbols, including banks and non-bank issuers.
- Be suspicious of any feature that only works for one symbol.
- If a provider is flaky, solve it in the backend once rather than teaching each widget to cope separately.

## Oracle env profile

For the Oracle backend deployment path, the current recommended runtime profile is:

```env
ENVIRONMENT=production
DATA_BACKEND=hybrid
CACHE_BACKEND=auto
APPWRITE_WRITE_ENABLED=false
ALLOW_ANONYMOUS_DASHBOARD_WRITES=true
APPWRITE_POPULATE_BATCH_SIZE=500
APPWRITE_POPULATE_CONCURRENCY=5
APPWRITE_POPULATE_MAX_ROWS=1000
APPWRITE_POPULATE_FULL_MAX_ROWS=0
APPWRITE_POPULATE_RESUME=true
VNSTOCK_SOURCE=KBS
VNSTOCK_CALLS_PER_MINUTE=100
INTRADAY_SYMBOLS_PER_RUN=60
SCHEDULER_LIVE_SYMBOLS_PER_RUN=60
SCHEDULER_SUPPLEMENTAL_SYMBOLS_PER_RUN=120
SCHEDULER_WEEKEND_SYMBOLS_PER_RUN=300
SCHEDULER_COMPANY_NEWS_LIMIT=10
ORDERFLOW_AT_CLOSE_ONLY=true
ORDERBOOK_AT_CLOSE_ONLY=true
STORE_INTRADAY_TRADES=false
INTRADAY_REQUIRE_MARKET_HOURS=true
INTRADAY_ALLOW_OUT_OF_HOURS_IN_PROD=false
SKIP_SCHEDULER_STARTUP=false
SKIP_WEBSOCKET_STARTUP=false
```

## Oracle env review notes

### Safe to keep

- `DATA_BACKEND=hybrid`
- `CACHE_BACKEND=auto`
- `APPWRITE_WRITE_ENABLED=false`
- `VNSTOCK_CALLS_PER_MINUTE=100`
- `SKIP_SCHEDULER_STARTUP=false`
- `SKIP_WEBSOCKET_STARTUP=false`

### Appwrite during quota pressure

During an Appwrite write freeze, keep Appwrite configured only for legacy reads or controlled off-peak backfills.

- runtime writes should stay disabled with `APPWRITE_WRITE_ENABLED=false`
- durable state should live in `Postgres/Supabase`
- dashboards should remain local-first with SQL durable save
- verify deploys with `bash scripts/oracle/runtime_verify.sh` before treating a rollout as successful

### Why `CACHE_BACKEND=auto` is acceptable

In this backend, `auto` resolves to Redis when `REDIS_URL` is configured, and falls back to memory only if Redis is unavailable.

That makes it a reasonable production default when the goal is graceful degradation instead of hard failure.

### Settings worth watching closely

- `ALEMBIC_STRICT=0`
  - safer for operational flexibility, but it can hide migration drift during deploys
  - acceptable if deploys are already controlled and migration status is monitored
- `VNSTOCK_RUNTIME_INSTALL=0`
  - recommended steady-state production value
  - keep runtime install disabled after the environment is bootstrapped
- `STORE_INTRADAY_TRADES=false`
  - recommended unless full raw intraday retention is a deliberate requirement
  - avoids unnecessary write amplification in SQL and Appwrite pipelines

### Memory cache fallback settings

- `MEMORY_CACHE_MAX_ENTRIES=200`
- `MEMORY_CACHE_MAX_ENTRY_BYTES=131072`

These only matter when the in-process fallback cache is used. They are defensive limits and are fine to keep in production.

### Startup tuning settings

- `STARTUP_DB_CHECK_TIMEOUT_SECONDS=12`
- `STARTUP_VNSTOCK_REG_TIMEOUT_SECONDS=10`
- `STARTUP_WS_TIMEOUT_SECONDS=5`
- `SKIP_WARMUP=false`

These are reasonable defaults. They keep startup bounded while leaving the scheduler and websocket pipeline enabled.

## OCI current setup

For the Oracle backend deployment, the current setup is: 
- Compute (ARM): 4 OCPUs and 24 GB of RAM
- Storage: 200 GB total Block Volume (boot/block) + 10 GB Object + 10 GB Archive.
- Network: 10 TB egress data transfer per month. (Load Balancer enabled, WAF not provisioned yet)

Possible expandable quota:
- Compute (x86): 2 x VM.Standard.E2.1.Micro instances (AMD). (provisioned)
- Database: 2 x Oracle Autonomous Databases (19c or 23ai). (provisioned)
