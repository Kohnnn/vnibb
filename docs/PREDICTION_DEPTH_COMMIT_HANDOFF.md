# Commit handoff — prediction-market read depth + truthful availability

Prepared 2026-09-26. Working tree: 63 modified files, 30 untracked. Branch `main`, remote `origin https://github.com/Kohnnn/vnibb.git`. Nothing staged; no commit created.

## What this change is

Two coupled workstreams are present in one dirty tree. The other session shipped Matrix
(`marker: matrix`, Hebbia-style widgets, `/matrix` MCP + copilot + harness) and the backup
preflight tooling. **This session's work is the prediction-market read depth below.** Commit
them separately; do not mix.

Primary intent: make existing prediction-market data honest and deep — no fabricated odds,
no invented history, all providers visible — without expanding ingestion.

### Container
`20260926_1200_bound_prediction_snapshots` — this session. Ships with the prediction work.

### Backend
| File | Change |
|---|---|
| `apps/api/vnibb/api/v1/prediction_markets.py` | bounded candidates on all reads; `extra`/`is_synthetic` on list rows; new exact `GET /{source}/{source_id}` detail; invalid-vector suppression in history; horizon-merged observations; absolute movement semantics; consensus null-volume fix |
| `apps/api/vnibb/services/prediction_market_policy.py` | new: shared `snapshot_eligibility`, `active_market_candidates` (per-source bound before filters), `observed_yes_price` |
| `apps/api/vnibb/services/prediction_market_estimator.py` | cache namespace keyed to filtered candidates; explicit `zip(..., strict=False)` |

### Frontend
`PredictionMarketDrawer.tsx` (portaled dialog, full contract context, 1d/7d/30d observed
history), `SourceWidget.tsx`, `PredictionMarketSource.tsx`,
`PredictionMarketSourceHealthStrip.tsx`, `ConsensusOddsWidget.tsx`,
`ElectionOddsWidget.tsx`, `CrossSourceCalibrationWidget.tsx`,
`usePredictionMarketConsensus.ts`.

### Tests this session owns
`tests/test_api/test_prediction_markets.py`, `test_prediction_market_phase8.py`,
`test_services/test_prediction_market_admission.py`,
`test_services/test_prediction_market_intraday_retention.py`,
`PredictionMarketDrawer.test.tsx`, `PolymarketWidget.test.tsx`,
`PredictionMarketSourceWidgets.test.tsx`, `ElectionOddsWidget.v2.test.tsx`,
`Phase8PredictionMarketWidgets.test.tsx`.

### Docs
`CHANGELOG.md`, `docs/API_REFERENCE.md`, `docs/WIDGET_SYSTEM_REFERENCE.md`.

## Reinforced

- **Line-ending churn removed.** 12 files had been rewritten LF→CRLF, which would have
  ballooned the diff by ~1,300 lines and buried the real change. Restored to repo LF
  convention; verified no remaining whitespace-only differences.
- **Real change sizes (whitespace-ignored).** `PredictionMarketSource.tsx` 63+/40− (was
  1019/1019 shown), `WIDGET_SYSTEM_REFERENCE.md` 23+/17− (was 942), `prediction_markets.py`
  135+/134−, `PredictionMarketDrawer.tsx` 180+/237−.
- **Route ordering safe.** `/{source}/{source_id}` is declared after every literal path
  (`/movers`, `/consensus`, `/spread`, `/alerts`, `/calibration`, `/estimate/*`,
  `/cross-calibration`, `/history`), so literal reads are not shadowed.
- **Detail path is strict and fresh.** Detail applies `snapshot_eligibility` and 404s when
  ineligible, consistent with the list contract.

## Verification (this session, on the frozen tree)

- `pytest` prediction + admission + intraday-retention suites: **49 passed**.
- `jest` prediction widget suites: **18 passed**.
- `ruff check` on `router.py`, `prediction_markets.py`, `prediction_market_policy.py`,
  `prediction_market_estimator.py`: clean.
- `eslint` on the affected and normalized frontend files: clean.
- Real-data browser smoke against production data over a read-only tunnel: drawer renders
  full contract context, history shows 6 real intraday observations with an observed
  −0.2 pp change and explicit coverage limits, unpriced Kalshi markets show `No data` with
  no invented trend, Escape closes and restores focus.

## Second workstream this session: node catalogue retention

Independent of the read-depth change; commit it on its own. Root cause and
measurements are in `docs/CLOUD01_NODE_OPTIMIZATION_2026-09-26.md`.

| File | Change |
|---|---|
| `apps/api/vnibb/services/prediction_market_catalogue_retention.py` | new: bounded, resumable, dry-run-by-default debris sweep |
| `apps/api/vnibb/services/prediction_market_policy.py` | adds `MARKET_RETENTION`, `MARKET_RETENTION_BATCH`, `market_retention_cutoff` |
| `apps/api/vnibb/services/kalshi_service.py` | `KALSHI_MAX_PAGES` 10 → 2 plus a hard `KALSHI_INGEST_BUDGET` (400) |
| `apps/api/vnibb/core/scheduler.py` | `schedule_prediction_market_catalogue_retention()` at 19:40 UTC daily |
| `apps/api/migrations/versions/20260926_1800_index_stale_prediction_markets.py` | concurrent `(updated_at, id)` index for the walk |
| `apps/api/tests/test_services/test_prediction_market_catalogue_retention.py` | 6 tests |
| `apps/api/tests/test_api/test_kalshi_service.py` | ingest-budget regression |

Verification: 6 retention tests and the Kalshi budget regression pass; the full
prediction suite is 55 passing. The sweep walks the stale end in ~3 ms per batch
versus ~112 s for the naive count, and the live node drained 8 M rows in its
first pass with every service healthy. Apply the index migration through Alembic
before enabling the job.

## Typecheck status (blocker resolved)

`pnpm --filter frontend exec tsc --noEmit` **exits 0** as of this writing. The
earlier `AICopilot.matrix.test.tsx` failure (`CopilotResponseMeta` missing
`mode`/`latencyMs`) has been fixed by the Matrix workstream. Re-run it before
committing; if it fails again the fault is in Matrix's files, not these.

## Shared files — expect conflict

Matrix and this workstream both edit these, so they cannot be separated by path
alone. Whoever commits second must re-read and merge by hand:

`CHANGELOG.md`, `apps/api/vnibb/api/v1/copilot.py`,
`apps/api/vnibb/api/v1/router.py`, `apps/api/vnibb/mcp/server.py`,
`apps/api/vnibb/services/llm_service.py`,
`apps/web/src/components/shell/DashboardClient.tsx`,
`apps/web/src/components/ui/AICopilot.tsx`,
`apps/web/src/components/widgets/WidgetRegistry.ts`,
`apps/web/src/components/widgets/index.ts`,
`apps/web/src/data/changelog.generated.ts`,
`apps/web/src/data/widgetDefinitions.ts`, `apps/web/src/lib/api.ts`,
`apps/web/src/lib/dashboardLayout.ts`, `apps/web/src/types/dashboard.ts`.

Line endings were normalized on several of these. The normalization only returns
CRLF to the LF form already committed in `HEAD`; it removes no Matrix content.

## Suggested commit plan

Explicit path lists so a commit can be staged without sweeping in Matrix work.

### Commit 1 — read depth
`feat(prediction): bounded fresh-catalogue reads and exact contract detail`

```
apps/api/vnibb/api/v1/prediction_markets.py
apps/api/vnibb/services/prediction_market_policy.py
apps/api/vnibb/services/prediction_market_estimator.py
apps/api/migrations/versions/20260926_1200_bound_prediction_snapshots.py
apps/api/tests/test_api/test_prediction_markets.py
apps/api/tests/test_api/test_prediction_market_phase8.py
docs/API_REFERENCE.md
```

### Commit 2 — frontend honesty and depth
`feat(web): contract-depth drawer and truthful provider states`

```
apps/web/src/components/widgets/SourceWidget.tsx
apps/web/src/components/widgets/PredictionMarketSource.tsx
apps/web/src/components/widgets/PredictionMarketDrawer.tsx
apps/web/src/components/widgets/PredictionMarketSourceHealthStrip.tsx
apps/web/src/components/widgets/ConsensusOddsWidget.tsx
apps/web/src/components/widgets/ElectionOddsWidget.tsx
apps/web/src/components/widgets/CrossSourceCalibrationWidget.tsx
apps/web/src/components/widgets/usePredictionMarketConsensus.ts
apps/web/src/components/widgets/PredictionMarketDrawer.test.tsx
apps/web/src/components/widgets/PredictionMarketSourceWidgets.test.tsx
apps/web/src/components/widgets/PolymarketWidget.test.tsx
apps/web/src/components/widgets/ElectionOddsWidget.v2.test.tsx
apps/web/src/components/widgets/Phase8PredictionMarketWidgets.test.tsx
docs/WIDGET_SYSTEM_REFERENCE.md
```

### Commit 3 — catalogue retention (node workstream)
`fix(prediction): bound the catalogue and reclaim node storage`

```
apps/api/vnibb/services/prediction_market_catalogue_retention.py
apps/api/vnibb/services/kalshi_service.py
apps/api/vnibb/core/scheduler.py
apps/api/migrations/versions/20260926_1800_index_stale_prediction_markets.py
apps/api/tests/test_services/test_prediction_market_catalogue_retention.py
apps/api/tests/test_api/test_kalshi_service.py
docs/CLOUD01_NODE_OPTIMIZATION_2026-09-26.md
```

### Commit 4 — changelog
`docs(changelog): prediction depth, availability, and catalogue retention`

`CHANGELOG.md` only. It carries entries for commits 1–3 and overlaps the Matrix
changelog edit; merge by hand if Matrix lands first.

Everything else in the dirty tree belongs to the Matrix and backup-preflight
workstreams and must not be staged with any of the above.

### Generated artifact

`apps/web/src/data/changelog.generated.ts` is produced from `CHANGELOG.md` by
`apps/web/scripts/generate-changelog.mjs` (wired to `predev`/`prebuild`). It was
regenerated after the changelog edit, so it now carries this workstream's entry
**and** the Matrix entries already present. Commit it with commit 4, after
`CHANGELOG.md` is final; regenerate again if the changelog changes.

## Scope guardrails

- Ingestion, snapshot writers, and deploy definitions were intentionally untouched: history
  reads merge existing daily/intraday observations and never synthesise rows.
- No shims, aliases, or fallbacks were added; unavailable data is reported as unavailable.
