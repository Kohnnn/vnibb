# VNIBB

<div align="center">

![VNIBB Logo](./logo.svg)

**Vietnam-first financial analytics workspace for serious equity research, market scanning, and agent-assisted workflows**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-20%20CI-339933.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688)](https://fastapi.tiangolo.com/)

[Live Demo](https://vnibb-web.vercel.app/) · [Docs Hub](../docs/README.md) · [Development Journal](../docs/DEVELOPMENT_JOURNAL.md)

</div>

---

# For human

## Product Introduction

VNIBB is a dashboard-driven research platform for Vietnamese equities.

It combines:

- a high-density widget workspace for fundamentals, technicals, quant, sector rotation, and company intelligence
- a FastAPI backend that normalizes messy local-market data into product-ready responses
- bank-aware analytics, market-structure tools, and Vietnam-specific workflows that generic global terminals usually miss
- a repo structure and documentation style that make it practical for AI agents to continue development, debugging, and deployment work

The goal is not to be just another screener or charting page. VNIBB is meant to feel like a serious research cockpit for Vietnam-focused investors, builders, and agents.

## What Makes It Different

- **Vietnam-first modeling**: the app is designed around Vietnamese equities, not retrofitted from a US-market product
- **OpenBB-inspired workflow**: dense, modular, multi-widget research surfaces instead of shallow page-by-page navigation
- **OpenBB-inspired AI copilot**: Appwrite-first context, validated source citations, evidence panels, and reasoning/status events
- **Bank-aware analytics**: banks are treated as a distinct analytical class, not forced into industrial-company ratios
- **Fallback-first backend**: provider instability, missing values, and schema quirks are handled in the backend instead of leaking directly into the UI
- **Agent-friendly repo**: phased planning, ops notes, AGENTS guidance, and docs make handoff to other coding agents much easier

## Quick Start

Run from `vnibb/`.

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile
python -m pip install -e "apps/api[dev]"

# 2. Add env values to apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/v1/ws/prices

# 3. Start backend
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api

# 4. Start frontend
pnpm --filter frontend dev

# 5. Open: http://localhost:3000 (frontend) and http://localhost:8000/docs (API docs)
```

---

# For AI coding agents

## Quick handoff prompt

```
You are working on VNIBB, a Vietnam-first financial analytics monorepo.

Start here:
1. Read `AGENTS.md`
2. Read `docs/README.md` (docs hub)
3. Work from `vnibb/`

Install:
- `pnpm install --frozen-lockfile`
- `python -m pip install -e "apps/api[dev]"`

Run:
- frontend: `pnpm --filter frontend dev`
- backend: `python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api`

Validate:
- `pnpm --filter frontend exec tsc --noEmit`
- `pnpm --filter frontend lint`
- `python -m ruff check apps/api`
- `python -m pytest apps/api/tests -v`
- `pnpm run ci:gate`

Key context:
- Active product code lives in `vnibb/`
- Docs and planning live in `../docs/` and `.agent/`
- Backend is FastAPI, frontend is Next.js 16 + React 19
- Primary configs: `package.json`, `scripts/ci-gate.mjs`, `apps/api/pyproject.toml`
- Never commit secrets, tokens, keys, or `.env*` files
```

## Fast commands for common tasks

### Fix a bug

```bash
# 1. Run narrow test first
pnpm --filter frontend test -- --runTestsByPath src/lib/financialPeriods.test.ts -t "bug description"
python -m pytest apps/api/tests/test_api/test_news_service.py -v -k "test_name"

# 2. Fix the code
# 3. Validate
pnpm --filter frontend exec tsc --noEmit
python -m ruff check apps/api
pnpm --filter frontend lint

# 4. Run broader test
pnpm --filter frontend test
python -m pytest apps/api/tests -v

# 5. Full gate before commit
pnpm run ci:gate
```

### Add a feature

```bash
# 1. Read relevant existing code patterns
# 2. Implement smallest coherent change
# 3. Add test
# 4. Validate
pnpm --filter frontend exec tsc --noEmit
pnpm --filter frontend lint
python -m ruff check apps/api
# 5. Full gate
pnpm run ci:gate
```

### Fix lint/type errors

```bash
# TypeScript
pnpm --filter frontend exec tsc --noEmit
pnpm --filter frontend lint --fix

# Python
python -m ruff check apps/api --fix
```

## Built-in validation

```bash
pnpm run ci:gate        # Full gate: lint → build → test → compile → pytest
pnpm run gate:no502     # Widget health probe (5 repeats, 10s timeout)
```

## Documentation

- docs hub: `../docs/README.md`
- product overview: `../docs/PRODUCT_OVERVIEW.md`
- architecture: `../docs/ARCHITECTURE.md`
- development setup: `../docs/DEVELOPMENT_SETUP.md`
- API reference: `../docs/API_REFERENCE.md`
- widget catalog: `../docs/WIDGET_CATALOG.md`
- deployment and operations: `../docs/DEPLOYMENT_AND_OPERATIONS.md`
- development journal: `../docs/DEVELOPMENT_JOURNAL.md`
- agent instructions: `AGENTS.md`

## License

MIT. See `LICENSE`.

---

# Architecture Reference

## System Overview

VNIBB is a monorepo with three main layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        End Users / Agents                           │
│           (Investors, Quants, Research Agents, AI Cops)             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    apps/web (Next.js 16)                           │
│   Dashboard UI, Widgets, TanStack Query, React Context, Routing     │
│   Port: 3000                                                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│     apps/api (FastAPI)        │   │    External Services           │
│     Port: 8000                │   │    - VNStock API              │
│                               │   │    - PostgreSQL                │
│  Middleware → Routes →        │   │    - Redis Cache              │
│    Services → Providers       │   │    - Appwrite (optional)       │
│                               │   │    - Scrapers (fallback)      │
└───────────────────────────────┘   └───────────────────────────────┘
```

## Frontend Architecture

```
apps/web/src/
├── app/                    # Next.js App Router pages
├── components/
│   ├── widgets/           # 50+ research widgets (FinancialsWidget, etc.)
│   │   └── charts/        # Chart sub-components
│   ├── ui/               # Shared UI (WidgetContainer, WidgetSkeleton, etc.)
│   └── common/           # ExportButton, ProtectedRoute, etc.
├── contexts/             # React contexts
│   ├── DashboardContext   # Widget layout state
│   ├── SymbolContext      # Current stock symbol
│   ├── ThemeContext       # Light/dark mode
│   ├── AuthContext        # Appwrite/Supabase auth
│   └── ...
├── hooks/                # Custom hooks (usePeriodState, useWebSocket, etc.)
├── lib/
│   ├── api.ts           # fetchAPI() wrapper with error handling
│   ├── queries.ts       # TanStack Query hooks (useFinancialRatios, etc.)
│   ├── appwrite.ts      # Appwrite client
│   └── supabase.ts      # Supabase client
├── types/               # TypeScript interfaces
└── styles/             # Global CSS
```

### Frontend Data Flow

```
Widget (tsx)
   │
   ├─ useFinancialRatios(symbol, { period })
   │
   └─► TanStack Query
        ├─ queryKey: ['financialRatios', 'VNM', 'FY']
        ├─ staleTime: 60 * 60 * 1000 (1 hour)
        └─ queryFn: api.getFinancialRatios(symbol, params, signal)
             │
             └─► fetchAPI('/equity/{symbol}/ratios')
                  ├─ Adds Authorization header
                  ├─ Handles timeout (default 30s)
                  └─ Returns typed response
```

### Key API Client Features (`lib/api.ts`)

- `fetchAPI<T>()` - Central fetch wrapper with:
  - Configurable timeout (default 30s)
  - Automatic query parameter handling
  - Authorization token management (Appwrite JWT or Supabase)
  - Structured error handling (`APIError`, `RateLimitError`)

### TanStack Query Pattern

```typescript
useQuery({
  queryKey: queryKeys.financialRatios(symbol, period),
  queryFn: ({ signal }) => api.getFinancialRatios(symbol, { period }, signal),
  staleTime: 60 * 60 * 1000, // 1 hour
});
```

## Backend Architecture

### Entry Point (`apps/api/vnibb/api/main.py`)

FastAPI application with middleware stack (outer to inner):

```
1. CORSMiddleware          # CORS headers
2. CORSErrorMiddleware     # CORS on exceptions
3. APIVersionMiddleware    # API version headers
4. RequestLoggingMiddleware # Request ID + error logging
5. ResponseCacheControlMiddleware # Cache headers by endpoint
6. GZipMiddleware          # Compression
7. RequestTimeoutMiddleware # Global timeout
8. PerformanceLoggingMiddleware # Latency logging
9. MetricsMiddleware       # Sentry performance
10. RateLimitMiddleware    # Rate limiting (120 req/min)
```

**Lifespan Events**: Startup validation → Redis connect → Scheduler start → WebSocket broadcaster → vnstock pre-init

### Backend Directory Structure

```
apps/api/vnibb/
├── api/
│   ├── main.py            # FastAPI app factory, middleware, exception handlers
│   ├── router.py          # Route aggregation
│   ├── deps.py            # Dependency injection
│   └── v1/
│       ├── equity.py      # /equity/{symbol}/* endpoints
│       ├── screener.py    # /screener endpoints
│       ├── financials.py  # /financials endpoints
│       ├── dashboard.py   # /dashboard endpoints
│       ├── data_sync.py   # /data pipeline triggers
│       ├── realtime.py    # /stream real-time
│       ├── technical.py   # /analysis technical
│       ├── market.py      # /market indices, sectors
│       ├── news.py        # /news, /market/news
│       ├── websocket.py   # WebSocket /ws/prices
│       ├── quant.py       # /quant analytics
│       ├── comparison.py  # /compare, /analysis
│       ├── rs_rating.py   # /rs relative strength
│       ├── copilot.py     # /copilot AI
│       ├── health.py      # /health checks
│       └── ...
├── core/
│   ├── config.py          # Pydantic Settings, env validation
│   ├── database.py       # SQLAlchemy async engine
│   ├── cache.py           # Redis + memory fallback, @cached decorator
│   ├── auth.py            # JWT validation
│   ├── exceptions.py      # VniBBException hierarchy
│   ├── rate_limiter.py    # Slowapi configuration
│   └── logging_config.py  # Structured JSON logging
├── models/                # Pydantic response models
│   ├── financials.py
│   ├── market_news.py
│   ├── stock.py
│   └── ...
├── providers/
│   ├── base.py            # BaseFetcher abstract class
│   ├── retry.py           # Retry logic
│   ├── errors.py          # Provider exceptions
│   └── vnstock/           # VNStock API fetchers (50+)
│       ├── equity_historical.py
│       ├── financials.py
│       ├── financial_ratios.py
│       └── ...
├── services/              # Business logic
│   ├── financial_service.py   # TTM calculation, period normalization
│   ├── screener_service.py    # Screener data sync
│   ├── market_service.py      # Market indices, top movers
│   ├── comparison_service.py  # Stock comparison
│   ├── news_service.py        # News fetching
│   ├── technical_analysis.py  # Technical indicators
│   ├── rs_rating_service.py  # Relative Strength
│   ├── cache_manager.py       # Multi-tier cache
│   ├── fallback_resolver.py   # Provider fallback chain
│   └── ...
└── utils/
    └── validators.py
```

## Data Flow: Full Request Lifecycle

```
1. REQUEST
   │
   ▼
2. MIDDLEWARE STACK
   ├─ CORS check
   ├─ Rate limit check (120 req/min)
   ├─ Request logging
   └─ Timeout check (30s global)
   │
   ▼
3. ROUTER → ROUTE HANDLER
   └─ @cached(ttl=86400, key_prefix="ratios_v3")
   │
   ▼
4. SERVICE LAYER
   │
   ├─► Check Redis Cache
   │    ├─ HIT → Return cached data
   │    └─ MISS → Continue
   │
   └─► Provider Chain
        │
        ├─► Primary: VNStock API
        │    ├─ SUCCESS → Cache + Return
        │    └─ FAIL → Continue
        │
        ├─► Secondary: Scraper Fallback
        │    ├─ SUCCESS → Cache + Return
        │    └─ FAIL → Continue
        │
        └─► Tertiary: Appwrite Storage
             ├─ SUCCESS → Return
             └─ FAIL → Return stale cache or DataNotFoundError
   │
   ▼
5. RESPONSE
   ├─ Cache-Control header set
   ├─ Response logged
   └─ Return to client
```

## Caching Strategy

### Cache Backends

| Backend | Use Case | TTL |
|---------|----------|-----|
| **Redis** | Primary cache | 30s - 24h |
| **Memory** | Fallback when Redis unavailable | Same as Redis |

### Cache Key Patterns

```
v:sc:<hash>    # screener
v:q:<hash>     # quote
v:r:<hash>     # ratios
v:f:<hash>     # financials
v:is:<hash>    # income statement
v:n:<hash>     # news
```

### Response Cache Headers

| Policy | Endpoints | Header |
|--------|-----------|--------|
| `real_time` | `/health`, `/equity/*/quote` | `no-store, max-age=0` |
| `near_real_time` | `/screener`, `/sectors`, `/historical` | `public, max-age=30, stale-while-revalidate=90` |
| `staticish` | `/profile`, `/ratios`, `/financials` | `public, max-age=300, stale-while-revalidate=1800` |

## Fallback Chain

```
Request
   │
   ▼
1. Check Redis Cache
   │
   ▼
2. Try Primary Provider (VNStock)
   │   └─ API: VNStock (KBS, VCI, DNSE sources)
   │
   ▼
3. Try Scraper Fallback
   │   └─ cophieu68 historical scraper
   │
   ▼
4. Try Appwrite Storage
   │   └─ Price data archival
   │
   ▼
5. Return Stale Cache (if available)
   │
   ▼
6. Raise DataNotFoundError
```

## Data Storage Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        External Sources                           │
│   VNStock API ──batch sync──> Appwrite ──serve──> FastAPI ──> UI │
└──────────────────────────────────────────────────────────────────┘

Appwrite Collections (26 total):
├── stocks, stock_prices, stock_indices
├── income_statements, balance_sheets, cash_flows, financial_ratios
├── foreign_trading, order_flow_daily, orderbook_snapshots
├── dividends, company_events, insider_deals
├── company_news, shareholders, officers, subsidiaries
├── market_sectors, sector_performance, screener_snapshots
├── user_dashboards, dashboard_widgets, system_dashboard_templates
└── intraday_trades, derivative_prices

Redis Cache: Session, rate limits, API response cache (TTL: 30s - 24h)
```

## Database Schema (Appwrite)

VNIBB uses **Appwrite** as its primary data store with 26 collections.

For detailed schema with all attributes and relationships, see:
- [Appwrite Schema Reference](../../docs/APPWRITE_SCHEMA.md)

### Core Collections

| Collection | Purpose | Key Attributes |
|------------|---------|----------------|
| `stocks` | Stock master data | symbol, exchange, industry, sector |
| `stock_prices` | Historical OHLCV | symbol, time, interval, open, high, low, close, volume |
| `income_statements` | Income data | symbol, period, revenue, net_income, eps |
| `balance_sheets` | Balance sheet | symbol, period, total_assets, total_liabilities, total_equity |
| `cash_flows` | Cash flow | symbol, period, operating_cash_flow, free_cash_flow |
| `financial_ratios` | Ratios | symbol, period, pe_ratio, pb_ratio, roe, roa |
| `foreign_trading` | Foreign trades | symbol, trade_date, buy_value, sell_value, net_value |
| `screener_snapshots` | Daily screener | symbol, snapshot_date, price, volume, market_cap, pe, pb |
| `orderbook_snapshots` | Price depth | symbol, snapshot_time, bid1-3, ask1-3 |
| `company_news` | News | symbol, title, source, published_date |
| `user_dashboards` | User layouts | user_id, name, layout_config |
| `dashboard_widgets` | Widget configs | dashboard_id, widget_type, layout, widget_config |

### Key Relationships

```
stocks (1) ──┬── (*) stock_prices       # Historical prices
             ├── (*) financial_ratios    # Ratio history
             ├── (*) income_statements  # Quarterly/annual income
             ├── (*) balance_sheets     # Balance sheet data
             ├── (*) cash_flows         # Cash flow data
             ├── (*) dividends          # Dividend history
             ├── (*) foreign_trading    # Daily foreign trades
             ├── (*) company_news       # News articles
             ├── (*) insider_deals      # Insider transactions
             └── (*) screener_snapshots # Daily snapshots

companies (1) ──┬── (*) shareholders    # Major shareholders
                 ├── (*) officers        # Company officers
                 └── (*) subsidiaries    # Subsidiary companies

user_dashboards (1) ── (*) dashboard_widgets
```

### Data Sync Flow

```
VNStock API ──batch sync──> Appwrite Collections
                              │
                              ├── stocks
                              ├── stock_prices
                              ├── financial_ratios
                              ├── income_statements
                              ├── balance_sheets
                              ├── cash_flows
                              ├── foreign_trading
                              ├── dividends
                              └── company_news
```

## API Routes Reference

### Route Groups (mounted under `/api/v1`)

| Router | Prefix | Description |
|--------|--------|-------------|
| equity | `/equity` | Stock data: profile, ratios, financials, historical |
| screener | `/screener` | Stock screening with filters |
| financials | `/financials` | Unified financial statements |
| dashboard | `/dashboard` | User dashboards & widgets |
| data_sync | `/data` | Data pipeline triggers |
| realtime | `/stream` | Real-time streaming |
| technical | `/analysis` | Technical analysis |
| market | `/market` | Market indices, sectors |
| news | `/news` | News feeds |
| listing | `/listing` | Stock listings, symbols |
| search | `/search` | Ticker search |
| trading | `/trading` | Top movers, price boards |
| quant | `/quant` | Quant analytics |
| comparison | `/compare` | Stock comparison |
| rs_rating | `/rs` | Relative Strength ratings |
| websocket | `/ws` | WebSocket for real-time |
| copilot | `/copilot` | AI copilot |
| health | `/health` | Health checks |

### Key Equity Endpoints

```
GET /api/v1/equity/{symbol}/profile        # Company profile
GET /api/v1/equity/{symbol}/quote          # Real-time quote
GET /api/v1/equity/{symbol}/historical     # Historical OHLCV
GET /api/v1/equity/{symbol}/ratios         # Financial ratios
GET /api/v1/equity/{symbol}/financials     # Financial statements
GET /api/v1/equity/{symbol}/income-statement
GET /api/v1/equity/{symbol}/balance-sheet
GET /api/v1/equity/{symbol}/cash-flow
GET /api/v1/equity/{symbol}/dividends
GET /api/v1/equity/{symbol}/news
GET /api/v1/equity/{symbol}/foreign-trading
```

### Key Market Endpoints

```
GET /api/v1/market/indices              # Vietnam indices
GET /api/v1/market/world-indices        # Global indices
GET /api/v1/market/top-gainers         # Top gaining stocks
GET /api/v1/market/top-losers          # Top losing stocks
GET /api/v1/market/sector-performance  # Sector performance
```

## Provider Pattern (OpenBB-style Fetchers)

Each data fetcher follows a 3-step pattern:

```python
class VnstockFinancialsFetcher(BaseFetcher):
    def transform_query(self, params: FinancialsQueryParams) -> dict:
        # Convert Pydantic params to provider format
        pass

    def extract_data(self, transformed: dict) -> RawData:
        # Make API call, return raw data
        pass

    def transform_data(self, raw: RawData) -> List[FinancialStatementData]:
        # Convert raw data to Pydantic models
        pass
```

## Error Handling

### Frontend Errors (`src/lib/api.ts`)

```typescript
export class APIError extends Error {
  status?: number;
  statusText?: string;
}

export class RateLimitError extends APIError {
  retryAfter: number; // seconds
}
```

### Backend Errors (`core/exceptions.py`)

```
VniBBException (base)
├── ProviderError
│   ├── ProviderTimeoutError
│   ├── ProviderRateLimitError
│   └── ProviderAuthError
├── DataNotFoundError
├── DataValidationError
├── StaleDataError
├── DatabaseError
├── CacheError
└── InvalidParameterError
```

## Testing recommendations

1. run the narrowest relevant test for the touched area
2. run package-level validation if the change is broader
3. finish with `pnpm run ci:gate` for substantial work

Example flows:

- frontend UI change -> `pnpm --filter frontend exec tsc --noEmit` + relevant Jest test
- backend service fix -> focused `pytest` target + broader backend tests
- cross-stack change -> package checks + `pnpm run ci:gate`

## Acknowledgments

- inspired by [OpenBB](https://github.com/OpenBB-finance/OpenBB)
- shaped by Vietnamese market workflows and local data realities
- informed by iterative parity checks against both OpenBB Pro and Vietnamese market products
- built for both human researchers and agentic development workflows

## License

MIT. See `LICENSE`.
