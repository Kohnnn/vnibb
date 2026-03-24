# VNIBB

<div align="center">

![VNIBB Logo](./logo.svg)

**Vietnam-first financial analytics platform for investors, quants, and agentic tools**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.11-blue.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688)](https://fastapi.tiangolo.com/)

[Live demo](https://vnibb-web.vercel.app/) · [API docs](./docs/API_REFERENCE.md) · [Widget catalog](./docs/WIDGET_CATALOG.md)

</div>

---

## What This Repo Contains

VNIBB is a monorepo that combines the web application, API server, and shared packages used to power Vietnamese market analysis workflows.

### Apps

- `apps/web` - Next.js 16 frontend with React 19, dashboard UI, widgets, and Jest tests.
- `apps/api` - FastAPI backend with async SQLAlchemy, pytest, Ruff, and production-oriented startup checks.

### Packages

- `packages/shared` - shared TypeScript utilities.
- `packages/ui` - reusable UI package built with `tsup`.
- `packages/widgets` - reusable widget package built with `tsup`.
- `packages/providers` - Python provider package.

### Highlights

- 40+ market and financial widgets.
- Screener, fundamentals, technical, quant, and market-monitoring workflows.
- Backend APIs for quotes, statements, news, sectors, dashboards, exports, and admin health.
- Shared workspace commands for linting, builds, tests, and CI-style validation.

---

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Testing Library, Jest, optional Playwright.
- Backend: FastAPI, Pydantic v2, SQLAlchemy 2, pytest, Ruff.
- Workspace: `pnpm` + Turborepo.
- Data: vnstock-centered provider flow with database/cache fallback layers.

---

## Getting Started

### Prerequisites

- Node.js 18+
- `pnpm` 9+
- Python 3.11+ for the API package (`apps/api`)

### 1. Install JavaScript dependencies

```bash
pnpm install
```

### 2. Install backend dependencies

```bash
python -m pip install -e "apps/api[dev]"
```

### 3. Configure env files

Typical local files already referenced by the repo:

- `apps/web/.env.local`
- `apps/api/.env`

At minimum, local frontend development usually needs:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/v1/ws/prices
```

### 4. Start the frontend

```bash
pnpm --filter frontend dev
```

Open `http://localhost:3000`.

### 5. Start the backend

```bash
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api
```

Open `http://localhost:8000/docs` when debug docs are enabled.

---

## Workspace Commands

### Root commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm ci:gate
```

Notes:

- `pnpm build`, `pnpm lint`, and `pnpm test` run through Turborepo.
- `pnpm test` mainly exercises the frontend workspace.
- `pnpm ci:gate` is the strict local validation path and runs:
  - frontend lint
  - frontend build
  - frontend tests with `--runInBand`
  - backend compile check
  - backend pytest suite

### Frontend commands

```bash
pnpm --filter frontend dev
pnpm --filter frontend build
pnpm --filter frontend lint
pnpm --filter frontend test
pnpm --filter frontend test -- --watch
pnpm --filter frontend test -- --runInBand
```

### Run a single frontend test

```bash
pnpm --filter frontend test -- --runTestsByPath src/lib/financialPeriods.test.ts
pnpm --filter frontend test -- --runTestsByPath src/components/widgets/FinancialRatiosWidget.test.tsx
pnpm --filter frontend test -- --runTestsByPath src/lib/financialPeriods.test.ts -t "formats yearly labels from year strings"
```

### Backend commands

```bash
python -m py_compile apps/api/vnibb/api/main.py
python -m pytest apps/api/tests -v
python -m pytest apps/api/tests -q
python -m ruff check apps/api
```

### Run a single backend test

```bash
python -m pytest apps/api/tests/test_api/test_news_service.py -v
python -m pytest apps/api/tests/test_api/test_news_service.py -k hydrates -v
python -m pytest apps/api/tests/test_integration/test_api_integration.py -v
```

### Package builds

```bash
pnpm --filter @vnibb/shared build
pnpm --filter @vnibb/ui build
pnpm --filter @vnibb/widgets build
```

### Database migrations

```bash
alembic -c apps/api/alembic.ini upgrade head
```

---

## Repository Layout

```text
.
├── apps/
│   ├── api/        # FastAPI backend
│   └── web/        # Next.js frontend
├── packages/
│   ├── providers/  # Python provider package
│   ├── shared/     # Shared TS utilities
│   ├── ui/         # Reusable UI package
│   └── widgets/    # Widget package
├── docs/           # Project and ops docs
├── scripts/        # Root automation and CI helpers
├── AGENTS.md       # Repo instructions for coding agents
└── package.json    # Workspace entrypoint
```

---

## Development Notes

- Use `pnpm` for JavaScript work and `python -m ...` for Python commands.
- Prefer root-level commands unless you are debugging a specific package.
- Treat `scripts/ci-gate.mjs` as the source of truth for local validation order.
- Avoid editing generated output such as `.next/`, `dist/`, `.turbo/`, or local database/log artifacts unless the task requires it.
- Frontend uses the `@/` alias for app-local imports in `apps/web`.

---

## Documentation

- API reference: `docs/API_REFERENCE.md`
- Widget catalog: `docs/WIDGET_CATALOG.md`
- Production health notes: `docs/v47_production_health.md`
- Changelog: `CHANGELOG.md`
- Agent instructions: `AGENTS.md`

---

## Contributing

Keep changes focused and validate with the narrowest relevant command first, then with `pnpm ci:gate` for broader changes.

Examples:

- frontend-only UI change -> run frontend lint/test for the touched area.
- backend service change -> run targeted pytest first, then broader backend tests.
- cross-cutting change -> finish with `pnpm ci:gate`.

---

## License

MIT. See `LICENSE`.

---

## Acknowledgments

- Inspired by [OpenBB](https://github.com/OpenBB-finance/OpenBB)
- Built around Vietnamese market workflows and vnstock-based provider integrations
- Designed for both human analysts and agentic coding/research tools
