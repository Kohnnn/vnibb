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
CORS_ORIGINS=["https://vnibb.vercel.app"]
ENVIRONMENT=production
```

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
