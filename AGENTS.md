# AGENTS.md

This repository is a mixed monorepo with a Next.js frontend, a FastAPI backend, and a few shared packages.
Use `pnpm` for JavaScript work and `python -m ...` for Python work.

## Repo Shape

- `apps/web`: Next.js 16 + React 19 frontend, Jest unit tests, optional Playwright config.
- `apps/api`: FastAPI backend packaged via `pyproject.toml`, pytest + Ruff.
- `packages/shared`, `packages/ui`, `packages/widgets`: small TypeScript packages built with `tsup`.
- Root CI gate lives in `scripts/ci-gate.mjs` and is the best source of truth for the full local validation path.

## Rule Files

- No `.cursor/rules/` directory was found.
- No `.cursorrules` file was found.
- No `.github/copilot-instructions.md` file was found.
- No existing `AGENTS.md` was present when this file was generated.

## Install

### JavaScript workspace

```bash
pnpm install
```

### Backend Python env

```bash
python -m pip install -e "apps/api[dev]"
```

### Providers package only

```bash
python -m pip install -e "packages/providers"
```

## High-Value Commands

### Full repo checks

```bash
pnpm lint
pnpm build
pnpm test
pnpm ci:gate
```

Notes:

- `pnpm lint` / `pnpm build` / `pnpm test` run through Turborepo.
- `pnpm ci:gate` is stricter and explicitly runs frontend lint/build/test plus backend compile + pytest.
- On this repo, `pnpm test` mainly covers the frontend; backend tests are run directly with pytest.

### Frontend (`apps/web`)

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

Guidance:

- Run from repo root with `pnpm --filter frontend ...`.
- Jest config is in `apps/web/jest.config.mjs`.
- Use `--runInBand` when debugging flaky DOM tests.

### Playwright (`apps/web`)

```bash
pnpm --filter frontend exec playwright test
pnpm --filter frontend exec playwright test path/to/spec.ts
pnpm --filter frontend exec playwright test -g "test name"
```

Notes:

- `apps/web/playwright.config.ts` exists, but no `apps/web/e2e` tests were present during analysis.
- The config expects the web app at `http://localhost:3000`.

### Backend (`apps/api`)

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

Guidance:

- Prefer `python -m pytest ...` over bare `pytest` for consistency.
- Most backend tests are async and use fixtures in `apps/api/tests/conftest.py`.
- Test env bootstrapping is fixture-driven; avoid requiring real provider credentials in unit tests.

### Backend runtime and migrations

```bash
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api
alembic -c apps/api/alembic.ini upgrade head
```

### Package builds

```bash
pnpm --filter @vnibb/shared build
pnpm --filter @vnibb/ui build
pnpm --filter @vnibb/widgets build
```

## Source-of-Truth Configs

- Root JS scripts: `package.json`
- Frontend scripts: `apps/web/package.json`
- Backend tooling: `apps/api/pyproject.toml`
- Frontend tests: `apps/web/jest.config.mjs`
- Frontend E2E config: `apps/web/playwright.config.ts`
- Lint baseline: `eslint.config.mjs`
- Full gate order: `scripts/ci-gate.mjs`

## Code Style Guidelines

### General

- Make the smallest coherent change; do not refactor unrelated areas.
- Preserve the architecture split: UI in `apps/web`, API/service logic in `apps/api`, reusable TS in `packages/*`.
- Do not edit generated or runtime artifacts like `.next/`, `dist/`, `.turbo/`, `node_modules/`, log files, or local `.db` files unless the task explicitly requires it.
- Prefer repo-local patterns over generic framework defaults.

### Formatting

- TypeScript formatting is not fully standardized by an autoformatter in-repo; preserve the surrounding file's semicolon, quote, and indentation style.
- Python should stay Ruff-compatible with a max line length of 100.
- Avoid formatting-only churn.
- Keep imports, whitespace, and wrapping consistent with the file you touch.

### Imports

- In `apps/web`, prefer the `@/` alias for app-local imports.
- Keep imports grouped logically: framework/external first, then internal aliases, then relative imports if needed.
- Use `import type` for type-only TypeScript imports when practical; this pattern is already common in the repo.
- In Python, Ruff enables isort rules, so keep stdlib / third-party / local imports separated cleanly.
- Avoid deep relative import chains when an existing alias or package import is available.

### Types

- Frontend TypeScript runs with `strict: true`; do not introduce `any` unless there is a clear boundary and no practical alternative.
- Prefer explicit response/data interfaces over anonymous object shapes for API-facing code.
- Reuse shared domain types from `apps/web/src/types/*` and backend models/schemas where possible.
- In Python, keep type hints on public functions and important service boundaries.
- Use `Optional[...]` / `T | None` semantics consistently with the existing file.

### Naming

- React components, classes, and context providers: `PascalCase`.
- Hooks: `useSomething`.
- TS variables/functions: `camelCase`.
- TS constants: `UPPER_SNAKE_CASE` only for true constants shared as constants; otherwise follow file-local style.
- Python modules, functions, variables: `snake_case`.
- Python classes and Pydantic/ORM models: `PascalCase`.
- Test names should describe behavior, not implementation details.

### React / Frontend Conventions

- Prefer small focused components and hooks over giant inline blocks unless extending an already-large file.
- Keep stateful logic in hooks/contexts/lib helpers when it improves reuse.
- Match existing data-fetching patterns (`queries`, context providers, API helpers) instead of introducing new fetch abstractions casually.
- Reuse existing widget state components and error/loading affordances.
- Preserve accessibility patterns already present: button labels, keyboard handlers, fallback text, and semantic roles.

### Backend Conventions

- Keep request/response handling in routers, business logic in services, and configuration/infrastructure in `core`.
- Prefer dependency-injected or helper-based access over hidden globals when touching service boundaries.
- Fail fast on invalid input with structured `HTTPException` or project exceptions.
- Preserve startup resilience patterns: many backend paths intentionally log warnings and degrade gracefully instead of crashing.
- Keep expensive provider/network work behind service functions, not embedded directly in many route handlers.

### Error Handling

- Frontend: throw or surface typed errors with actionable messages; existing code uses `APIError`, `RateLimitError`, error boundaries, and retry UIs.
- Backend: either raise `HTTPException` for API-level validation errors or use project exceptions like `VniBBException` derivatives for domain failures.
- Log useful context, but do not log secrets, tokens, or raw credential material.
- Preserve existing fallback behavior when providers fail; this codebase often prefers degraded data over total failure.

### Testing Expectations

- Add or update tests when changing behavior, especially in API services, endpoint transforms, hooks, utilities, and widget states.
- Frontend tests use Jest + Testing Library; prefer behavior assertions over implementation details.
- Backend tests use pytest with async fixtures and monkeypatch heavily; prefer mocking provider edges rather than calling live services.
- For bug fixes, add a regression test near the affected module when practical.

### Practical Agent Rules

- Check nearby files before introducing a new pattern.
- Preserve mixed-style files rather than reformatting them wholesale.
- If a command in docs conflicts with `scripts/ci-gate.mjs`, trust `scripts/ci-gate.mjs` first.
- When in doubt, validate with the narrowest relevant test, then with the broader package/repo command if the change is larger.
