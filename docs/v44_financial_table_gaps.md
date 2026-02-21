# V44 Financial Table Gaps

Date: 2026-02-15

## Baseline Reference

- Reference target: OpenBB financial table patterns (dense rows, sticky metric column, strong period controls, grouped rows, sortable columns).

## Current VNIBB Status

- `FinancialsWidget` already supports unified statement tabs and period switching (FY/QTR/TTM).
- Unit scaling and unit legend are available through shared unit utilities.
- Financial endpoints were hardened with DB fallback in `apps/api/vnibb/api/v1/equity.py`, reducing empty-table failures when provider data is sparse.
- Theme-token migration is partially applied to table/controls for light-mode compatibility.

## Remaining Gaps vs OpenBB

1. Dense table parity is partial; row density and sticky-first-column behavior are not fully aligned across all financial views.
2. Explicit grouped financial hierarchies (expand/collapse with subtotal persistence) are not fully implemented.
3. Column-level sorting behavior is limited/inconsistent across statement types.
4. Long-period horizontal navigation and sticky UX under narrow viewports still need dedicated QA.
5. Manual parity validation screenshots/evidence are missing in `docs/openbb_reference/` for final closure.

## Completed in This Execution Window

- Backend fallback logic added for:
  - `/equity/{symbol}/financials`
  - `/equity/{symbol}/income-statement`
  - `/equity/{symbol}/balance-sheet`
  - `/equity/{symbol}/cash-flow`
- Frontend build/type gates pass after lazy-load registry typing fixes.

## Next Closure Steps

1. Finish dense-table UX parity pass (sticky metric column + dense rows across all statement tabs).
2. Add/verify grouped metric hierarchy with expand/collapse controls.
3. Capture OpenBB-vs-VNIBB screenshots and append evidence under `docs/openbb_reference/`.
4. Re-run final V44 gate (`tsc`, lint, build, backend tests) after table parity polish.
