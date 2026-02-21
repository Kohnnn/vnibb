# V44 Comparison Analysis Gaps

Date: 2026-02-15

## Baseline Reference

- Reference target: OpenBB comparison workflow (multi-ticker chips, normalized overlay chart, period presets, side-by-side metric table).

## Current VNIBB Status

- `ComparisonAnalysisWidget` has progressed to multi-symbol support with expanded period presets.
- Normalized comparison behavior and metrics table are present in current implementation direction.
- Related backend services (`comparison.py`, `comparison_service.py`) were touched for parity and resiliency during the sprint window.

## Remaining Gaps vs OpenBB

1. Explicit chip UX polish (add/remove feedback, max-ticker affordances, keyboard flow) still needs final pass.
2. Chart+table synchronization under rapid symbol changes requires final stress QA.
3. Empty/error guidance for sparse symbols is improved but not fully standardized across all comparison subviews.
4. Visual parity evidence (OpenBB side-by-side screenshots and checklist) is not yet complete.

## Validation in This Window

- Frontend gates currently pass:
  - `pnpm --filter frontend exec tsc --noEmit`
  - `pnpm --filter frontend lint`
  - `pnpm --filter frontend build`
- Backend tests currently pass:
  - `cd apps/api && python -m pytest tests -q` -> 57 passed

## Next Closure Steps

1. Finalize chip interactions and keyboard ergonomics.
2. Run targeted manual QA on VNM/FPT/VCB and one sparse ticker for failure-state consistency.
3. Record parity screenshots and close the remaining gap checklist.
