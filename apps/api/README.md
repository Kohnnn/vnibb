# VNIBB API - Backend Service

<div align="center">

**FastAPI Backend for VNIBB Financial Platform**

[![Deploy Target](https://img.shields.io/badge/Deploy-Oracle%20Cloud%20Always%20Free-F80000)](../../docs/oracle_runbook.md)
[![Python](https://img.shields.io/badge/Python-3.12-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-green)](https://fastapi.tiangolo.com/)

[Oracle Runbook](../../docs/oracle_runbook.md) · [Report Bug](https://github.com/Kohnnn/vnibb-api/issues) · [Request Feature](https://github.com/Kohnnn/vnibb-api/issues)

</div>

---

## 📋 Overview

High-performance REST API providing Vietnamese stock market data. Built with FastAPI, powered by vnstock, and prepared for Oracle Cloud Always Free compute hosting behind a stable custom API hostname.

---

## 🚀 Features

- **50+ API Endpoints** - Stocks, financials, news, sectors
- **Market Data** - Vietcap IQ primary, free vnstock VCI for supported gaps
- **Database** - Self-hosted database stack (system of record)
- **Caching** - Cache tier for performance
- **Docs** - Auto-generated Swagger/OpenAPI

---

## 🛠️ Tech Stack

- **Framework:** FastAPI 0.110
- **Language:** Python 3.12
- **Database:** Self-hosted database stack
- **ORM:** SQLAlchemy 2.0 (async)
- **Cache:** Cache tier with in-process memory fallback
- **Data:** Vietcap IQ primary and explicitly sourced VNStock 5.2.1 VCI supplement

---

## VNStock Alignment

- Both `VNSTOCK_RUNTIME_TIER=free` (default) and `golden` use the unified
  `vnstock` 5.2.1 SDK. CI and release images use publisher-wheel constraints in
  `constraints-vnstock.txt` while unrelated dependencies remain on public PyPI.
  The Python 3.12 slim image supports only `linux/amd64` and `linux/arm64`;
  its build rejects unsupported targets and does not fall back to a source build.
- `VNSTOCK_SOURCE=VCI` is required; KBS, TCBS, MSN, FMP and DNSE are not
  execution fallbacks. VCI shares upstream exposure with Vietcap IQ.
- Golden requires `VNSTOCK_API_KEY` via a deployment secret. Startup calls
  `vnstock.setup_api_key` and requires an authenticated `golden` or `diamond`
  result; a missing key, registration timeout, lock contention or insufficient
  tier aborts startup without disclosing the key. SDK registration verifies
  remotely and persists the credential locally. Do not commit or log it. Golden
  permits legacy sponsor packages but does not use them; neither tier installs
  packages at runtime.
- Free mode performs no startup account or registration check and does not
  inspect or delete persisted SDK credentials. Use an isolated `VNSTOCK_HOME`
  for CLI and scripts so a persisted paid account cannot be reused by accident.
  Free still rejects discoverable legacy sponsor packages before SDK import.
- Unsupported datasets report unavailable/provider failure; no alternate source
  or synthetic observations are substituted. Unit, reporting-basis and source
  admission remain mandatory. Entitlement does not authorize acquisition,
  persistence or redistribution, or establish dataset coverage.
- Default local pacing remains 18 main and 2 reinforcement calls per minute,
  with a 20/minute per-operation ceiling; Golden does not increase it automatically.
  This is not a cross-process quota ledger. International Yahoo feeds and the
  Vietcombank forex route are independent of Vietnamese VCI equity ingestion.

---

## 📁 Project Structure

```
vnibb/
├── api/              # FastAPI routers
│   └── v1/           # API v1 endpoints
├── core/             # Config, database
├── models/           # SQLAlchemy models
├── providers/        # Data providers (vnstock)
├── services/         # Business logic
└── scripts/          # Utility scripts
```

---

## 🏃 Quick Start

### Prerequisites
- Python 3.12+
- Access to the self-hosted database stack

### Installation

```bash
# Clone repository
git clone https://github.com/Kohnnn/vnibb-api.git
cd vnibb-api

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -e ".[dev]"

# Setup environment
cp .env.example .env

# Run migrations
alembic upgrade head

# Start server
uvicorn vnibb.api.main:app --reload
```

Open [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🌐 Deployment

### Deploy to Oracle Cloud

Follow [docs/oracle_runbook.md](../../docs/oracle_runbook.md) for the Oracle VM deploy, verify, cutover, and rollback sequence.

Build the immutable image outside OCI, publish it, resolve its digest, and set `VNIBB_API_IMAGE_REPOSITORY=registry.example.com/vnibb/api` plus `VNIBB_API_IMAGE_DIGEST=sha256:<digest>` in `deployment/env.oracle`. The image stores its build revision in `/app/.release-revision`; stale `RELEASE_REVISION` runtime keys cannot override health, logs, or Sentry. The same image serves free and Golden tiers; do not supply credentials at build time or install packages at container startup.

```bash
export IMAGE_RELEASE_REVISION="$(git rev-parse --verify HEAD)"
bash ../../scripts/oracle/build_release_image.sh registry.example.com/vnibb/api:<release-tag>
docker compose --env-file deployment/env.oracle -f ../../docker-compose.oracle.yml run --rm migrate
docker compose --env-file deployment/env.oracle -f ../../docker-compose.oracle.yml up -d --no-build api mcp caddy
```

The API must retain `API_SKIP_SCHEDULER_STARTUP=true`. Start the isolated scheduler only when Redis coordination is available:

```bash
docker compose --env-file deployment/env.oracle -f ../../docker-compose.oracle.yml --profile scheduler up -d --no-build scheduler
```

### Environment Variables

```env
DATABASE_URL=postgresql+asyncpg://...
CACHE_BACKEND=auto  # auto|cache-tier|memory
DATA_BACKEND=postgres  # Postgres is the only data backend
SUPABASE_JWT_SECRET=your-jwt-secret
ALLOW_ANONYMOUS_DASHBOARD_WRITES=true
REDIS_URL=redis://localhost:6379/0  # cache-tier connection
VNSTOCK_RUNTIME_TIER=free  # free|golden; golden requires VNSTOCK_API_KEY in the secret store
VNSTOCK_SOURCE=VCI
VNSTOCK_RUNTIME_INSTALL=0  # Runtime installation is disabled
VNSTOCK_RATE_LIMIT_RPS=0.3  # 18 main calls/minute
VNSTOCK_REINFORCEMENT_RPS=0.03333333333333333  # 2 calls/minute
VNSTOCK_CALLS_PER_MINUTE=20
ALEMBIC_STRICT=1  # Recommended for Oracle cutover so failed migrations do not boot a partial runtime
CORS_ORIGINS=["https://vnibb.vercel.app"]
CORS_ORIGIN_REGEX=^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?$|^https://[a-z0-9-]+\\.vercel\\.app$
ENVIRONMENT=production
OPENROUTER_API_KEY=your_openrouter_api_key
LLM_PROVIDER=openrouter
LLM_MODEL=openai/gpt-4o-mini
ENABLE_AI_SENTIMENT_ANALYSIS=0  # keep market news sentiment paused for stability-first deploys
# Optional OpenRouter attribution headers:
# OPENROUTER_SITE_URL=https://your-app.example.com
# OPENROUTER_APP_NAME=VNIBB

```

If `OPENROUTER_API_KEY` is not set, the copilot falls back to a configuration warning until you add the key or use a browser-local OpenRouter key in Settings.

Set `ENABLE_AI_SENTIMENT_ANALYSIS=0` to pause news sentiment processing entirely; crawled articles will be marked neutral so the news feed still works without AI load.

The self-hosted database stack is the expected primary runtime backend. Keep `DATABASE_URL` configured so the SQL path can act as a fallback/population source.

### Read-only MCP companion

This backend now includes a dedicated read-only MCP server for database-backed VNIBB access.

Local stdio usage:

```bash
vnibb-mcp --transport stdio
```

Remote HTTP usage:

```bash
vnibb-mcp --transport streamable-http --host 0.0.0.0 --port 8001
```

Key env values:
- `VNIBB_MCP_TRANSPORT=stdio|streamable-http`
- `VNIBB_MCP_PORT=8001`
- `VNIBB_MCP_URL=http://127.0.0.1:8001/mcp` for local API-to-MCP calls, or `http://mcp:8001/mcp` on OCI
- `VNIBB_MCP_SHARED_BEARER_TOKEN=<shared secret for remote deployments>`

When `VNIBB_MCP_URL` is configured, VniAgent runtime context reads use the MCP companion for selected database-backed reads instead of direct database access.

Canonical implementation notes live in `../../docs/VNIBB_MCP_READONLY.md`.

The single Dockerfile produces an immutable SDK runtime image; no authenticated
installer or runtime package installation is supported. See the
[VNStock reference](docs/vnstock_api_documentation.md) for registration, VCI
admission, unsupported routes and acquisition prerequisites.

---

## � API Documentation

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/screener` | GET | Stock screener |
| `/api/v1/stocks/{symbol}` | GET | Stock details |
| `/api/v1/financials/{symbol}` | GET | Financial statements |
| `/api/v1/sectors/top-movers` | GET | Sector performance |

**Full Docs:** `/docs` (Swagger UI)

### Retained market mover freshness

`GET /api/v1/market/top-movers` serves admitted retained daily-price rankings before provider acquisition. `is_stale` compares the original observation date with the latest completed market business day, using `VN_TIMEZONE`, `INTRADAY_MARKET_CLOSE` and `MARKET_HOLIDAY_DATES`, as detailed health does. The session date advances at the configured close, not at server midnight; before close, weekends and configured holidays retain the preceding completed session. The existing 120-second caches are unchanged.

Freshness calculation does not restamp prices, units, source, `updated_at` or `session_label`, and unknown price-unit evidence remains excluded. The configured closure list is not a verified exchange calendar or proof of complete market coverage. The unrelated Mongo weekday staleness floor is unchanged.

Issue #153 focused public-route regression: parent-owned network-isolated execution of `python -B -m pytest tests/test_api/test_retained_mover_session_freshness.py -q -p pytest_asyncio.plugin -p no:cacheprovider` from `apps/api` produced **24 failed / 12 passed** before the clock fix and **36 passed** after it. The permanent regression retains the **nine distinct clock cases**, verified again with **9 passed**, without repeating each clock for every ranking mode. The cases preserve source/session/unit assertions while covering preclose and exact-close boundaries, configured close/timezone and weekend/holiday transitions. A separate network-isolated stdlib smoke imported the actual market module and retained SQL loader against temporary SQLite observations: **32 route invocations passed** across eight clocks and all four modes with provider acquisition forbidden. These are application freshness checks, not source/calendar certification or production acceptance.

Workspace docs:
- `../../docs/API_REFERENCE.md`
- `../../docs/v47_production_health.md`
- `../../CHANGELOG.md`
- `docs/vnstock_api_documentation.md`

---

## Sprint V34 Ops Scripts

```bash
# 1) Core endpoint + widget health gate (returns non-zero on failure)
VNIBB_BASE_URL=https://api.example.com python scripts/widget_health_matrix.py --repeats 5 --timeout 10 --fail-on-error --output-json scripts/v34_widget_health_after.json

# 2) Resumable historical backfill (top 200, 5 years) - always timebox this run
python scripts/backfill_historical_v34.py --years 5 --limit 200 --batch-size 10 --max-runtime-minutes 20 --call-timeout-seconds 90 --hard-timeout-grace-seconds 30 --report-json scripts/v36_price_backfill_run.json

# 3) Resumable fundamentals/news/events recovery (timeboxed)
python scripts/backfill_fundamentals_v34.py --limit 200 --batch-size 10 --types ratios --max-runtime-minutes 15 --call-timeout-seconds 60 --report-json scripts/v36_ratios_backfill_run.json

# 4) Coverage delta vs V34 baseline
python scripts/v34_coverage_delta.py --run-current-audit --min-5y-improvement 1 --fail-on-miss

# 5) Daily coverage + freshness quality check
python scripts/data_quality_check.py --top-limit 200 --max-stale-days 7 --output-json scripts/data_quality_report.json
```

Notes:
- Never run unbounded backfills in shared/dev sessions; use `--max-runtime-minutes` on every run.
- `backfill_historical_v34.py` now includes a hard-timeout watchdog that force-exits after the runtime window + grace period and still writes checkpoint/report.

---

## 🧪 Testing

```bash
# Run tests
pytest

# Coverage
pytest --cov=vnibb

# Lint
ruff check .
```

---

## � License

MIT License - see [LICENSE](LICENSE)

---

## 🔗 Related Repos

- [vnibb-web](https://github.com/Kohnnn/vnibb-web) - Frontend app
- [vnibb-providers](https://github.com/Kohnnn/vnibb-providers) - Data providers
- [vnibb](https://github.com/Kohnnn/vnibb) - Main hub
- [mrgoonie/vnstock-agent](https://github.com/mrgoonie/vnstock-agent) - MCP/CLI wrapper around vnstock

---

<div align="center">

**Part of the [VNIBB](https://github.com/Kohnnn/vnibb) project**

</div>
