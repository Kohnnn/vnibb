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

> [Image 1]
> Personalized hero suggestion for this repo: a full-width VNIBB dashboard screenshot showing the `Initial` workspace with `Fundamentals`, `Technical`, and `Quant` views, using `VCI` as the main symbol, plus visible widgets such as Financials, Seasonality Heatmap, Signal Summary, Industry Bubble, and Bank Analytics.

## What Makes It Different

- **Vietnam-first modeling**: the app is designed around Vietnamese equities, not retrofitted from a US-market product
- **OpenBB-inspired workflow**: dense, modular, multi-widget research surfaces instead of shallow page-by-page navigation
- **OpenBB-inspired AI copilot**: Appwrite-first context, validated source citations, evidence panels, and reasoning/status events influenced by OpenBB copilot patterns
- **Bank-aware analytics**: banks are treated as a distinct analytical class, not forced into industrial-company ratios
- **Fallback-first backend**: provider instability, missing values, and schema quirks are handled in the backend instead of leaking directly into the UI
- **Agent-friendly repo**: phased planning, ops notes, AGENTS guidance, and docs make handoff to other coding agents much easier

## VNIBB Ecosystem

VNIBB is more than one app folder. It is a working system made of cooperating layers.

- `apps/web` - Next.js frontend for the dashboard, widget system, routing, and user-facing workflows
- `apps/api` - FastAPI backend for normalization, fallbacks, caching, logging, and API contracts
- `packages/shared` - shared TypeScript utilities
- `packages/ui` - reusable UI package
- `packages/widgets` - reusable widget package
- `scripts/ci-gate.mjs` - local source of truth for validation order
- `../docs/` - human-facing documentation for architecture, setup, widgets, ops, and project history
- `AGENTS.md` - repo instructions for coding agents

## Architecture

For the current copilot design and OpenBB-inspired AI notes, see `docs/ai_copilot.md`, `docs/ai_roadmap.md`, and `apps/api/docs/openbb_architecture.md`.

### System Architecture

```text
                              +----------------------+
                              |     End Users        |
                              |  Investors / Quants  |
                              |   Research Agents    |
                              +----------+-----------+
                                         |
                                         v
                     +-------------------------------------------+
                     |         apps/web (Next.js 16)             |
                     |  Dashboard UI, widgets, routing, queries  |
                     +-------------------+-----------------------+
                                         |
                                         v
                     +-------------------------------------------+
                     |        apps/api (FastAPI backend)         |
                     | validation, orchestration, normalization, |
                     | retries, caching, logging, rate limiting  |
                     +-------------------+-----------------------+
                                         |
                  +----------------------+----------------------+
                  |                      |                      |
                  v                      v                      v
      +------------------+   +---------------------+  +------------------+
      |  services layer  |   |  providers layer    |  |  core infra      |
      | business logic   |   | vnstock + fallback  |  | config/cache/log |
      +--------+---------+   +----------+----------+  +---------+--------+
               |                        |                       |
               +------------+-----------+-----------------------+
                            |
                            v
          +---------------------------------------------------------+
          | Appwrite / Redis / persisted cache / external providers |
          +---------------------------------------------------------+
```

### Data Flow

```text
User action
   |
   v
Widget -> query hook -> src/lib/api.ts
   |
   v
FastAPI route -> service -> provider/fallback chain
   |
   +--> fresh provider data succeeds -----------------------------+
   |                                                              |
   +--> provider unstable -> alternate source / cache / fallback  |
   |                                                              |
   +--> enrichment logic fills product-critical fields -----------+
                                                                  |
                                                                  v
                                                      normalized API response
                                                                  |
                                                                  v
                                                   widget renders loading / empty /
                                                   success state with stable contract
```

### Repo Layout

```text
vnibb/
|- apps/
|  |- web/
|  \- api/
|- packages/
|  |- shared/
|  |- ui/
|  \- widgets/
|- scripts/
|- docker-compose.oracle.yml
|- package.json
|- turbo.json
\- pnpm-workspace.yaml
```

## Quick Start

### From Source

Run from `vnibb/`.

1. Install JavaScript dependencies

```bash
pnpm install --frozen-lockfile
```

2. Install backend dependencies

```bash
python -m pip install -e "apps/api[dev]"
```

3. Add local env values

```env
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/v1/ws/prices
```

4. Start the backend

```bash
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api
```

5. Start the frontend

```bash
pnpm --filter frontend dev
```

6. Open:

- frontend: `http://localhost:3000`
- backend docs: `http://localhost:8000/docs`

### With Docker

VNIBB includes a production-oriented OCI compose file rather than a generic local-all-in-one dev compose.

Available container assets:

- `apps/api/Dockerfile`
- `apps/api/Dockerfile.premium`
- `apps/web/Dockerfile`
- `docker-compose.oracle.yml`

Example OCI-style compose run:

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --build
```

Notes:

- this path is closer to production deployment than local contributor setup
- local source-first development is still the recommended default


# For AI

If you want another coding agent to take over quickly, send it the repo link plus this instruction block.

## Prompt
```text
You are working on VNIBB, a Vietnam-first financial analytics monorepo.

Start here:
1. Read `AGENTS.md`
2. Read `docs/README.md`
3. Read `docs/DEVELOPMENT_JOURNAL.md`
4. Work from `vnibb/`

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

Important context:
- active product code lives in `vnibb/`
- docs history and planning live in `../docs/` and `.agent/`
- backend is FastAPI, frontend is Next.js 16 + React 19
- current roadmap focus is Phase 11 UX/workflow refinement
```

## Built-in Tools

### Workspace scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm run ci:gate
pnpm run gate:no502
pnpm run gate:widgets:strict
```

### Frontend commands

```bash
pnpm --filter frontend dev
pnpm --filter frontend build
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
pnpm --filter frontend test
pnpm --filter frontend test -- --runInBand
pnpm --filter frontend test -- --runTestsByPath src/lib/financialPeriods.test.ts
```

### Backend commands

```bash
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api
python -m ruff check apps/api
python -m py_compile apps/api/vnibb/api/main.py
python -m pytest apps/api/tests -v
python -m pytest apps/api/tests/test_api/test_news_service.py -v
python -m pytest apps/api/tests/test_api/test_financial_service.py::test_get_financials_with_ttm_caps_quarter_fetch_limit -v
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

## Testing

Recommended validation order:

1. run the narrowest relevant test for the touched area
2. run package-level validation if the change is broader
3. finish with `pnpm run ci:gate` for substantial work

Example flows:

- frontend UI change -> `pnpm --filter frontend exec tsc --noEmit` + relevant Jest test
- backend service fix -> focused `pytest` target + broader backend tests
- cross-stack change -> package checks + `pnpm run ci:gate`

## Project Status

Current position based on the active planning context:

- major Phase 7 financial data and hardening work completed
- major Phase 8 widget expansion completed
- major Phase 9 and 10 UX/product planning executed or prepared
- current refinement frontier is Phase 11

Current strategic focus:

- folder-level symbol scope
- consolidated financial workflows
- categorized comparison analysis
- stronger table hierarchy and readability
- tighter OpenBB-style workflow polish

## Acknowledgments

- inspired by [OpenBB](https://github.com/OpenBB-finance/OpenBB)
- shaped by Vietnamese market workflows and local data realities
- informed by iterative parity checks against both OpenBB Pro and Vietnamese market products
- built for both human researchers and agentic development workflows

## License

MIT. See `LICENSE`.
