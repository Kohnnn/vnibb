# VNIBB API - Backend Service

<div align="center">

**FastAPI Backend for VNIBB Financial Platform**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/...)
[![Python](https://img.shields.io/badge/Python-3.12-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-green)](https://fastapi.tiangolo.com/)

[API Docs](https://vnibb-api.railway.app/docs) · [Report Bug](https://github.com/Kohnnn/vnibb-api/issues) · [Request Feature](https://github.com/Kohnnn/vnibb-api/issues)

</div>

---

## 📋 Overview

High-performance REST API providing Vietnamese stock market data. Built with FastAPI, powered by vnstock, deployed on Railway.

---

## 🚀 Features

- **50+ API Endpoints** - Stocks, financials, news, sectors
- **Real-time Data** - vnstock Golden Sponsor integration
- **Database** - PostgreSQL with SQLAlchemy ORM
- **Caching** - Redis for performance
- **Docs** - Auto-generated Swagger/OpenAPI

---

## 🛠️ Tech Stack

- **Framework:** FastAPI 0.110
- **Language:** Python 3.12
- **Database:** PostgreSQL (Supabase)
- **ORM:** SQLAlchemy 2.0 (async)
- **Cache:** Redis (Upstash)
- **Data:** vnstock 3.4.0

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
- PostgreSQL or Supabase account

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

### Deploy to Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Deploy
railway up
```

### Environment Variables

```env
DATABASE_URL=postgresql+asyncpg://...
VNSTOCK_API_KEY=vnstock_xxx
VNSTOCK_RUNTIME_INSTALL=0  # Keep disabled; use Dockerfile.premium for premium builds
VNSTOCK_EXTRA_INDEX_URL=https://vnstocks.com/api/simple  # Optional premium index for vnii bootstrap
ALEMBIC_STRICT=0  # 1 = fail startup on migration error, 0 = continue startup with warning
CORS_ORIGINS=["https://vnibb.vercel.app"]
CORS_ORIGIN_REGEX=^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?$|^https://[a-z0-9-]+\\.vercel\\.app$
ENVIRONMENT=production
GEMINI_API_KEY=your_gemini_api_key
# Alternative accepted key name:
# GOOGLE_API_KEY=your_gemini_api_key
```

If neither `GEMINI_API_KEY` nor `GOOGLE_API_KEY` is set, news sentiment falls back to rule-based scoring.

Premium package strategy:
- Default `Dockerfile` keeps runtime installer disabled (`VNSTOCK_RUNTIME_INSTALL=0`) to avoid cold-start CPU spikes.
- Use `Dockerfile.premium` for prebuilt premium layers when `VNSTOCK_API_KEY` is available at build time.

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

Workspace docs:
- `../../docs/API_REFERENCE.md`
- `../../docs/v47_production_health.md`
- `../../CHANGELOG.md`

---

## Sprint V34 Ops Scripts

```bash
# 1) Core endpoint + widget health gate (returns non-zero on failure)
python scripts/widget_health_matrix.py --base-url https://vnibb.zeabur.app --repeats 5 --timeout 10 --fail-on-error --output-json scripts/v34_widget_health_after.json

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

---

<div align="center">

**Part of the [VNIBB](https://github.com/Kohnnn/vnibb) project**

</div>
