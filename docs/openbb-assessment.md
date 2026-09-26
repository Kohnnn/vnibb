# OpenBB-finance public repository assessment (for VNIBB)

**Date:** 2026-09-26 (all timestamps UTC)
**Method:** Read-only GitHub REST/`gh` API probes plus raw first-party file fetches from `raw.githubusercontent.com`, PyPI JSON API, and OpenBB docs. No repository was cloned, no OpenBB code was copied, and no build/test/lint/formatter was run. All figures are first-party (OpenBB-owned) or GitHub/PyPI metadata at the stated time.
**Decision status:** none. This is inventory + assessment.
**Relationship to existing docs:** VNIBB already documents OpenBB influence in [`apps/api/docs/openbb_architecture.md`](../apps/api/docs/openbb_architecture.md) and already ships several OpenBB-derived patterns (§6). This note is the org-level **inventory, recency, and license** companion to that architecture note — it supersedes nothing in it.

---

## TL;DR

1. **The org is exactly 43 public repos** (org metadata `public_repos: 43`; one API page returns all 43; `page=2` is empty). 5 archived, 1 fork (`google_workspace_mcp`, unrelated to finance).
2. **The 2026 headline: OpenBB is mid-relicense from AGPL-3.0 to Apache-2.0.** The `v5` branch contains `[V5] Update Repository License to Apache 2.0 (#7677)` (`8a1b5fd9`) from **2026-09-24**. The checked `develop`/`main` branches and the checked published PyPI packages `openbb` and `openbb-core` are still AGPL-3.0-only.
3. **VNIBB is MIT.** Do not copy AGPL-3.0 implementation into this MIT project without a licensing review; the Apache-2.0 `v5` source line is **not yet the published `openbb` package**.
4. **Public Workspace connectors and agents are not the Workspace UI.** The organization exposes MIT integration layers (`backends-for-openbb`, `agents-for-openbb`, `openbb-ai`, `agent-rita`), while the OpenBB README calls Workspace an enterprise UI available at `pro.openbb.co`. Its UI source was not found in the 43 org repos; public availability elsewhere was not established.
5. **No evidence of a newly published Workspace UI in this inventory.** The significant verified licensing event is the `v5` Apache change. A recent `pushed_at` date does not by itself establish a new open-source release.
6. **VNIBB already implements several OpenBB-inspired patterns** (fetcher interface, provider/router separation, reasoning/SSE copilot events, citations, chart/table artifacts). The next useful candidate is a standard screener contract and source-specific preset mapping, subject to a real provider-swap need.

---

## 1. Complete public repository inventory (all 43)

Source: `GET https://api.github.com/orgs/OpenBB-finance/repos?per_page=100&page=1`, 2026-09-26. Sorted by `pushed_at` (desc); `updated_at` differs where automated activity touched metadata only.

### 1.1 Core / platform

| # | Repo | Pushed | License (file) | Fork/Arch | Purpose |
|---|------|--------|----------------|-----------|---------|
| 1 | [OpenBB](https://github.com/OpenBB-finance/OpenBB) | 2026-09-26 | **AGPL-3.0** on `develop`/`main`; **Apache-2.0** on `v5` | – | Open Data Platform (ODP): provider/standard-model monorepo, CLI, desktop |
| 2 | [openbb-metricsv2](https://github.com/OpenBB-finance/openbb-metricsv2) | 2026-09-26 | MIT | – | Company public-metrics service |
| 3 | [pytest_recorder](https://github.com/OpenBB-finance/pytest_recorder) | 2026-09-24 | MIT | – | Pytest plugin for recording/replaying Web API tests |

### 1.2 Workspace connectors, apps, agents

| # | Repo | Pushed | License | Purpose |
|---|------|--------|---------|---------|
| 4 | [agents-for-openbb](https://github.com/OpenBB-finance/agents-for-openbb) | 2026-07-01 | MIT | Example custom agents for Workspace |
| 5 | [agent-rita](https://github.com/OpenBB-finance/agent-rita) | 2026-08-26 | MIT | Production-shaped TS/Bun copilot agent + optional MCP server |
| 6 | [backends-for-openbb](https://github.com/OpenBB-finance/backends-for-openbb) | 2026-07-29 | MIT | "Bring your own data" backend template (`widgets.json` contract) |
| 7 | [openbb-ai](https://github.com/OpenBB-finance/openbb-ai) | 2026-08-18 | MIT | SDK (v2.2.0) for Workspace-compatible agents |
| 8 | [openbb-platform-pro-backend](https://github.com/OpenBB-finance/openbb-platform-pro-backend) | 2026-08-24 | MIT | Widgets JSON for Terminal Pro |
| 9 | [widgets-library](https://github.com/OpenBB-finance/widgets-library) | 2026-08-24 | MIT | Terminal Pro widgets library |
| 10 | [design-system](https://github.com/OpenBB-finance/design-system) | 2026-08-24 | MIT | UI design-system components |
| 11 | [openbb-outsampler](https://github.com/OpenBB-finance/openbb-outsampler) | 2026-08-24 | MIT | Workspace backend connector (Outsampler) |
| 12 | [bls-app](https://github.com/OpenBB-finance/bls-app) | 2026-08-24 | MIT | BLS Workspace app service |
| 13 | [eia-app](https://github.com/OpenBB-finance/eia-app) | 2026-08-24 | MIT | US EIA Workspace app service |
| 14 | [polymarket-app](https://github.com/OpenBB-finance/polymarket-app) | 2026-08-24 | MIT | Polymarket Workspace app service |
| 15 | [openbb-kalshi-app](https://github.com/OpenBB-finance/openbb-kalshi-app) | 2026-08-24 | MIT | Kalshi app |
| 16 | [openbb-snaptrade](https://github.com/OpenBB-finance/openbb-snaptrade) | 2026-08-24 | MIT | SnapTrade brokerage connector |
| 17 | [openbb-simudyne-demo](https://github.com/OpenBB-finance/openbb-simudyne-demo) | 2026-08-24 | MIT | Simudyne demo app service |
| 18 | [hsdl-app](https://github.com/OpenBB-finance/hsdl-app) | 2026-08-24 | MIT | HSDL app service |
| 19 | [openbb-brightquery](https://github.com/OpenBB-finance/openbb-brightquery) | 2026-08-24 | MIT | BrightQuery app prototyping |
| 20 | [cftc-app](https://github.com/OpenBB-finance/cftc-app) | 2026-07-04 | **NONE** | CFTC Commitments of Traders app service |
| 21 | [google_workspace_mcp](https://github.com/OpenBB-finance/google_workspace_mcp) | 2026-04-22 | MIT | **fork** — Google Workspace MCP wrapper (not finance) |

### 1.3 Docs, examples, marketing

| # | Repo | Pushed | License | Purpose |
|---|------|--------|---------|---------|
| 22 | [openbb-docs](https://github.com/OpenBB-finance/openbb-docs) | 2026-08-24 | MIT | Docs website (MDX) |
| 23 | [openbb-docs-mcp](https://github.com/OpenBB-finance/openbb-docs-mcp) | 2026-08-24 | MIT | MCP server exposing OpenBB docs (two-step retrieval) |
| 24 | [examples](https://github.com/OpenBB-finance/examples) | 2026-08-24 | MIT | Notebooks/scripts used in tweets |
| 25 | [landing-page](https://github.com/OpenBB-finance/landing-page) | 2026-08-24 | MIT | Older landing page (JS) |
| 26 | [marketing-website](https://github.com/OpenBB-finance/marketing-website) | 2026-09-02 | Apache-2.0 | openbb.co site (Astro+Tailwind) |
| 27 | [GamestonkTerminalGuide](https://github.com/OpenBB-finance/GamestonkTerminalGuide) | 2026-08-24 | MIT | Legacy Gamestonk guide |
| 28 | [uptime](https://github.com/OpenBB-finance/uptime) | 2026-09-01 | MIT | Status page (upptime) |
| 29 | [awesome-openbb](https://github.com/OpenBB-finance/awesome-openbb) | 2026-06-30 | MIT | Curated links to apps/widgets/agents |

### 1.4 Legacy / archived / dormant

| # | Repo | Pushed | License | Fork/Arch | Purpose |
|---|------|--------|---------|-----------|---------|
| 30 | [LegacyCLI](https://github.com/OpenBB-finance/LegacyCLI) | 2025-01-27 | MIT | **archived** | Legacy OpenBB CLI |
| 31 | [openbb-bot](https://github.com/OpenBB-finance/openbb-bot) | 2024-09-22 | NONE | **archived** | Bot |
| 32 | [pywry](https://github.com/OpenBB-finance/pywry) | 2024-05-29 | MIT | **archived** | HTML/pywebview rendering (Rust) |
| 33 | [test-gitflow](https://github.com/OpenBB-finance/test-gitflow) | 2024-04-25 | MIT | **archived** | Gitflow sandbox |
| 34 | [DiscordBot](https://github.com/OpenBB-finance/DiscordBot) | 2021-09-27 | MIT | **archived** | Legacy Discord bot |
| 35 | [experimental-openbb-platform-agent](https://github.com/OpenBB-finance/experimental-openbb-platform-agent) | 2024-07-22 | NONE | – | R&D agent playground (1348★) |
| 36 | [openbb-forecast](https://github.com/OpenBB-finance/openbb-forecast) | 2024-07-19 | **AGPL-3.0** | – | Forecasting extension |
| 37 | [openbb-cookiecutter](https://github.com/OpenBB-finance/openbb-cookiecutter) | 2025-10-23 | MIT | – | Extension template |
| 38 | [linqalpha-workshop](https://github.com/OpenBB-finance/linqalpha-workshop) | 2025-10-24 | NONE | – | Workshop material |
| 39 | [hackathon](https://github.com/OpenBB-finance/hackathon) | 2024-05-20 | NONE | – | Fintech AI Hackathon |
| 40 | [OptionPricingModels](https://github.com/OpenBB-finance/OptionPricingModels) | 2022-12-23 | MIT | – | LaTeX option pricing notes |
| 41 | [BenchmarkForecast](https://github.com/OpenBB-finance/BenchmarkForecast) | 2022-10-14 | MIT | – | Forecasting benchmark tool |
| 42 | [openbb-docs-old](https://github.com/OpenBB-finance/openbb-docs-old) | 2023-04-03 | NONE | – | Old docs |
| 43 | [.github](https://github.com/OpenBB-finance/.github) | 2025-05-28 | NONE | – | Org profile |

---

## 2. What actually changed recently — and what is genuinely *newly open source*

`pushed_at` is misleading. Two mechanisms explain recent dates:

**(a) Similar activity dates are not release evidence.** Several repos have `pushed_at` around **2026-08-24** (`widgets-library`, `design-system`, `eia-app`, `hsdl-app`, `polymarket-app`, `bls-app`, `openbb-snaptrade`, `openbb-kalshi-app`, `openbb-simudyne-demo`, `GamestonkTerminalGuide`, `openbb-brightquery`, `openbb-outsampler`, `openbb-docs`, `openbb-docs-mcp`, `examples`, `landing-page`). Commit-by-commit classification was not performed; these timestamps alone cannot establish whether functionality or licensing changed.

**(b) The substantive 2026 change is the pending Apache relicensing, on a branch, not a release.**

- `develop` (default) and `main`: `LICENSE` = *"All files … GNU Affero General Public License v3.0."*
- Commit **`[V5] Update Repository License to Apache 2.0 (#7677)`** = `8a1b5fd9`, **2026-09-24**, on **`v5`** only; `v5/LICENSE` now = Apache-2.0.
- Branch **`update-license-to-apache`** (tip `d9f40f49`, *"Update license to Apache"*, 2026-09-24) is `develop` + one commit rewriting `LICENSE` (+201/−665), **unmerged** (`compare/develop...update-license-to-apache` → `ahead_by: 1`).
- `v5` is an active **v2.0 development line**: tip `d377ba94` = *"test publish pipeline with openbb-core-v2.0.0rc0 (#7681)"*, **2026-09-26T02:51:50Z** — this is what produces the repo's `pushed_at: 2026-09-26`.
- **Checked PyPI packages remain AGPL-3.0-only**: `openbb` 4.7.2 and `openbb-core` 1.6.13. Do not assume the branch license applies to an installed wheel.

The organization includes older and 2026-created repos. Creation/publication history for each repo was not exhaustively reconstructed, so this inventory cannot establish that *only* the `v5` license change counts as newly open source.

Provenance: [v5 license commit](https://github.com/OpenBB-finance/OpenBB/commit/8a1b5fd9), [v5 tip](https://github.com/OpenBB-finance/OpenBB/commit/d377ba94), [update-license-to-apache branch](https://github.com/OpenBB-finance/OpenBB/tree/update-license-to-apache), [v5 license](https://github.com/OpenBB-finance/OpenBB/blob/v5/LICENSE), [develop license](https://github.com/OpenBB-finance/OpenBB/blob/develop/LICENSE), [published openbb metadata](https://pypi.org/pypi/openbb/json), [published openbb-core metadata](https://pypi.org/pypi/openbb-core/json).

---

## 3. License scope — verified from actual files

### 3.1 The monorepo is single-license (not per-subtree)

- Root `LICENSE` (`develop`/`main`): AGPL-3.0; header says *"**All files in this repository** are licensed under the … AGPL v3.0."*
- Package metadata agrees, so subtrees are not separately licensed: `openbb_platform/pyproject.toml` → `license = "AGPL-3.0-only"`; `openbb_platform/core/pyproject.toml` (`openbb-core` 1.6.13) → `AGPL-3.0-only`. On `v5` the same root pyproject → `Apache-2.0`.
- The AGPL text contains only the standard *"Additional permissions"* boilerplate (AGPL §7); **no OpenBB-specific exception or link-exception** exists in the file.

**Consequence for MIT VNIBB:** direct incorporation of AGPL implementation into VNIBB risks copyleft and network-service source-sharing obligations. Merely using a separate program through an interface is a different licensing question; obtain a concrete review before embedding, importing, or distributing the current AGPL packages in this service. Use the designs as references; do not copy their code into VNIBB by default.

### 3.2 Per-repo license (actual files)

- **MIT:** the whole integration layer — `backends-for-openbb` (verified `LICENSE` = MIT, © 2024 OpenBB), `agents-for-openbb`, `openbb-ai`, `agent-rita`, `openbb-docs`, `openbb-docs-mcp`, `design-system`, `widgets-library`, `openbb-platform-pro-backend`, and every `*-app` service except `cftc-app`.
- **Apache-2.0:** `marketing-website`.
- **AGPL-3.0:** `OpenBB`, `openbb-forecast`.
- **No license file** (all rights reserved): `cftc-app`, `linqalpha-workshop`, `hackathon`, `.github`, `openbb-bot`, `experimental-openbb-platform-agent`, `openbb-docs-old`. **Not reusable.**
- **Fork:** `google_workspace_mcp` (MIT).

### 3.3 Service vs. code

- **Workspace UI not located in these public repos:** the [OpenBB README](https://github.com/OpenBB-finance/OpenBB#openbb-workspace) describes it as an enterprise UI at `pro.openbb.co` and links separate integration repos. This inventory does not prove the UI's legal/proprietary status beyond the inspected org repositories.
- **Data-provider terms are separate from code license.** Provider READMEs (`openbb-yfinance`, `openbb-sec`, …) document installation only and link to `docs.openbb.co`; there are **no per-provider data-usage terms in-repo**. Upstream data (Yahoo, SEC EDGAR, Finviz, FMP, Nasdaq…) carries its own terms. This is the pattern to copy for VN data sources: keep data terms distinct from code license.

---

## 4. High-value findings for a VN stock research app

VNIBB today: FastAPI backend (`apps/api/vnibb`), provider layer with `BaseFetcher` (`apps/api/vnibb/providers/base.py`) over a `vnstock` adapter, `StandardResponse[T]` in four routers (`equity`, `quant`, `screener`, `apps_script`), read-only MCP server (`apps/api/vnibb/mcp/server.py`, ~16 read-only tools), widget packages (`packages/widgets`), and existing OpenBB-pattern adoption (§6).

### 4.1 Screener contract — the highest-value *untransferred* idea

OpenBB standardizes screening as **standard model + per-provider implementation + preset maps**:

- `openbb_platform/core/openbb_core/provider/standard_models/equity_screener.py` — `EquityScreenerQueryParams` / `EquityScreenerData` (`symbol`, `name`).
- Per-provider models: `finviz`, `fmp`, `nasdaq`, `yfinance`.
- `openbb_platform/providers/finviz/openbb_finviz/utils/screener_helper.py` — enum→provider-filter maps (`MARKET_CAP_MAP`, `INDUSTRY_MAP`) and INI presets (`screener_template.ini`).

**Relevance:** VNIBB's `docs/FUNDAMENTAL_SCREENER.md` and ICB-sector model want exactly this — a normalised screener contract with per-source filter translation (VCI/vnstock/TCBS) so named presets survive provider swaps. VNIBB can **mirror the design**; the code is AGPL and must not be copied.

Links (`develop`): [standard equity screener model](https://github.com/OpenBB-finance/OpenBB/blob/develop/openbb_platform/core/openbb_core/provider/standard_models/equity_screener.py), [Finviz preset translation](https://github.com/OpenBB-finance/OpenBB/blob/develop/openbb_platform/providers/finviz/openbb_finviz/utils/screener_helper.py).

### 4.2 `widgets.json` / `apps.json` connector contract (MIT, adoptable)

`backends-for-openbb` defines the Workspace data-integration contract: JSON data + a `widgets.json` per widget (name, category, type, endpoint, `dataKey`) + CORS (+ optional auth). `eia-app` shows the service layout (`apps.json`, `widgets.json`, `Dockerfile`, `app.json`). **MIT.**

**Relevance:** conceptually identical to VNIBB's "declare a widget → point at an endpoint" model (`packages/widgets`, `docs/WIDGET_SYSTEM_REFERENCE.md`). This is the cleanest safe reuse *if* VNIBB ever wants an OpenBB Workspace presence (e.g. an auth-aware, limited widget export). Do not treat it as a reason to migrate off VNIBB's own widget system.

### 4.3 Agent/SSE protocol (MIT, already largely adopted internally)

`openbb-ai` (v2.2.0, 2026-08-18): MIT SDK for Workspace agents — a `query` endpoint streaming SSE (`reasoning_step`, `message_chunk`, `table`, `chart`, `cite`/`citations`, `get_widget_data`, prompt suggestions) plus `agents.json`. `agents-for-openbb` has examples; `agent-rita` (TS/Bun/Hono/Vercel AI SDK) is a production reference that searches dashboards, runs in-process SQL, builds dashboards, streams cited answers, and ships an optional MCP server (web search, fetch, Mermaid, Python exec, doc RAG).

**Relevance:** `apps/api/docs/openbb_architecture.md` §"OpenBB AI Agent Patterns We Reused" already records that VNIBB adopted reasoning SSE, source attribution, table/chart artifacts, allowlisted actions, and a feedback loop from these repos. The remaining unimplemented items there are HTML artifacts and full tool-orchestration callbacks — and VNIBB's `WAVE_5_5_STRATEGY_EDITOR_SANDBOX_DESIGN.md` and the ProjectMap note both argue for **not** adding HTML/tool orchestration until sanitisation is trusted.

### 4.4 MCP servers (one AGPL, one MIT)

- `openbb_platform/extensions/mcp_server` (package `openbb-mcp-server` ^1.4.1) exposes platform endpoints as MCP tools — **AGPL, reference only**.
- `openbb-docs-mcp` (**MIT**) shows a lean two-tool docs-retrieval pattern (`identify_openbb_docs_sections` → `fetch_openbb_content` + citation instructions). VNIBB already runs its own read-only MCP server (`docs/VNIBB_MCP_READONLY.md`); this is a pattern reference, not a dependency.

### 4.5 Data/standard-model breadth (reference only)

`develop` ships 34 provider dirs (`sec`, `yfinance`, `fmp`, `finviz`, `nasdaq`, `tiingo`, `intrinio`, `tradier`, `federal_reserve`, `bls`, `eia`, `cftc`, `congress_gov`, `ecb`, `oecd`, `imf`, `tradingeconomics`, `tmx`, `government_us`, `multpl`, `stockgrid`, `seeking_alpha`, `benzinga`, `biztoc`, `wsj`, `cboe`, `deribit`, `alpha_vantage`, `econdb`, `famafrench`, `finra`). First-party work worth noting for *US financial-statement normalization*: `6a23408d` *"[Feature] Standardized Financial Statements From SEC Company Facts API (#7416)"* (2026-05-06) plus `openbb-sec` correctness fixes through 2026-07-14. **No VN provider exists**, so there is no VN data integration to reuse; the value is method, not code.

---

## 5. Adoption vs proposal (explicit separation)

### 5.1 Adoption candidates (license-compatible)

| Source | License | Reusable for VNIBB | Caveat |
|--------|---------|--------------------|--------|
| `backends-for-openbb` | MIT | `widgets.json`/`apps.json` connector contract, reference backend patterns | Only useful *with* proprietary Workspace; do not use to replace VNIBB's widget system |
| `agents-for-openbb` | MIT | Agent scaffolding examples | Already mined for patterns (see `openbb_architecture.md`) |
| `openbb-ai` | MIT | SSE agent protocol models/helpers | Workspace-shaped; adapt, don't import wholesale |
| `openbb-docs-mcp` | MIT | Two-step docs-retrieval MCP pattern | Pattern, not drop-in |
| `agent-rita` | MIT | Thin-harness agent + optional-MCP architecture reference | TS/Bun |
| `pytest_recorder` | MIT | API recording/replay for provider tests | Generic utility |
| `design-system` | MIT | UI component patterns | Not VN-specific |

**None is a data or screener engine.** They are plumbing around a proprietary UI and an AGPL core.

### 5.2 Proposals (build ourselves — no code transfer)

1. **Provenance and error truth first:** keep the existing API envelope stable while closing the gap where `BaseFetcher.fetch` turns upstream errors into `[]`; expose source, last-data date, cache/stale state, and failure vs legitimate empty responses to callers. Apply the existing `buildWidgetRuntime` helper where widgets still omit metadata. This directly supports the active product-trust plan; do not rewrite all 30 routers as a preliminary step.
2. **Normalized screener contract only when adding a second real source:** map equivalent filters and saved presets across VCI/vnstock/TCBS after verifying provider access and matching semantics. Existing per-field coverage work is higher priority than speculative pluggability. Reimplement without AGPL code transfer.
3. **MCP taxonomy and prompt templates** only where concrete user workflows require them; `docs/MCP_STRATEGY.md` already sketches tool families, and the read-only 16-tool surface is functional.
4. **Auth-aware Workspace widget export** only if VNIBB users actually want Workspace; the MIT `widgets.json` template supports a limited connector without migrating the dashboard.
5. **Document data-source terms separately from code licenses** when exposing new upstream feeds.
6. **Do not** add HTML-artifact or full tool-orchestration callbacks until sanitisation is trusted (aligns with `WAVE_5_5_STRATEGY_EDITOR_SANDBOX_DESIGN.md`).

---

## 6. Relationship to existing VNIBB docs (avoid contradiction)

- **`apps/api/docs/openbb_architecture.md`** already documents OpenBB v4 hexagonal architecture, the `BaseFetcher` interface (verified present at `apps/api/vnibb/providers/base.py`), and the agent patterns VNIBB reused. This note **does not** claim those patterns are newly discovered; it adds the org inventory, license scope, and recency.
- **`docs/MCP_STRATEGY.md`** already proposes MCP tool families and prompt templates; §5.2 above validates them against OpenBB's split rather than re-proposing them.
- **`docs/reverse-engineering/`** holds public competitor crawls; this assessment follows the same "public source, ideas-only" stance for the AGPL core.
- **`docs/README.md`** is the docs index; `docs/research/` holds dated incident/research notes, which is why this curated assessment lives at `docs/openbb-assessment.md` rather than inside `docs/research/`.

---

## 7. Provenance and limits

**Sources (first-party, all fetched 2026-09-26):**
- Org/repo metadata: [organization](https://api.github.com/orgs/OpenBB-finance), [43-repository listing](https://api.github.com/orgs/OpenBB-finance/repos?per_page=100&page=1); page 2 was empty.
- Licenses: [develop LICENSE](https://github.com/OpenBB-finance/OpenBB/blob/develop/LICENSE), [main LICENSE](https://github.com/OpenBB-finance/OpenBB/blob/main/LICENSE), [v5 LICENSE](https://github.com/OpenBB-finance/OpenBB/blob/v5/LICENSE), [develop package metadata](https://github.com/OpenBB-finance/OpenBB/blob/develop/openbb_platform/pyproject.toml), [v5 package metadata](https://github.com/OpenBB-finance/OpenBB/blob/v5/openbb_platform/pyproject.toml), [PyPI openbb](https://pypi.org/pypi/openbb/json), [PyPI openbb-core](https://pypi.org/pypi/openbb-core/json).
- Recency: [license commit](https://github.com/OpenBB-finance/OpenBB/commit/8a1b5fd9), [v5 tip](https://github.com/OpenBB-finance/OpenBB/commit/d377ba94), [unmerged comparison](https://github.com/OpenBB-finance/OpenBB/compare/develop...update-license-to-apache).
- Code: [screener standard model](https://github.com/OpenBB-finance/OpenBB/blob/develop/openbb_platform/core/openbb_core/provider/standard_models/equity_screener.py), [Finviz screener translation](https://github.com/OpenBB-finance/OpenBB/blob/develop/openbb_platform/providers/finviz/openbb_finviz/utils/screener_helper.py).
- Patterns: [backend templates](https://github.com/OpenBB-finance/backends-for-openbb), [agent examples](https://github.com/OpenBB-finance/agents-for-openbb), [agent SDK](https://github.com/OpenBB-finance/openbb-ai), [Agent Rita](https://github.com/OpenBB-finance/agent-rita), [docs MCP](https://github.com/OpenBB-finance/openbb-docs-mcp).
- Local: `VNIBB/vnibb/LICENSE` (MIT), `apps/api/docs/openbb_architecture.md`, `docs/MCP_STRATEGY.md`, `apps/api/vnibb/providers/base.py`, `apps/api/vnibb/api/v1/schemas.py`.

**Limits / not verified:** no repo was cloned, so only representative raw files/READMEs were inspected; a full per-repo code audit, commit-history reconstruction, the complete `v5`↔`develop` diff, and upstream data-provider terms were not performed. Whether Apache `v5` becomes the default/published package remains unverified. Tiny app repo purposes follow descriptions/READMEs rather than end-to-end execution.
