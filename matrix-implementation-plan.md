# Matrix implementation plan

Status: implementation authorized by the user on 2026-09-26. Canonical map: [Matrix specification and execution](https://github.com/Kohnnn/vnibb/issues/35). This approval supersedes planning-only scope; production deployment and third-party data permission are not implied. Preserve unrelated working-tree changes.

## Goal and contracts

A registered VNIBB Matrix widget compares an anchor company and editable peer shortlist (2–10), initially using the latest common fiscal year, with a common-quarter override. Four curated playbooks cover non-financial quality, banks, insurers and securities companies. Supported observations carry frozen typed values, exact serving-record evidence and limitations; unsupported sector metrics remain unavailable, never mapped to misleading generic proxies.

Store owner-bound immutable snapshots using existing PostgreSQL `app_kv`, one key per snapshot; separate review events and revocation from original payloads. Require verified existing user JWTs, not anonymous dashboard identifiers. Snapshot IDs are references, not grants. Recheck ownership/revocation on every open and handoff; user responses are no-store. Browser persistence contains refs/view preferences only. Do not create another market-data truth store or call providers to populate a Matrix.

Canonical decimal strings and one server-formatted display drive cells, previews, evidence and copied selection. Results bind entity/dimension/scope/revision, not coordinates. Shared reporting period does not imply matching reporting basis. Derived values identify formula and original observations; stored observations do not imply issuer/audited evidence. No view operation executes research.

## Ordered work and proof

- [x] **Backend authority:** typed schemas, bounded snapshot creation/retrieval/list, exact evidence resolution, append-only revision-bound review, revocation, explicit synthetic fixture. Reuse DB/auth/router seams. Prove source changes cannot alter a saved revision and wrong-owner/revoked refs disclose nothing.
  Observed: `apps/api/tests/test_api/test_matrix.py` plus `test_matrix_observations.py`, `test_matrix_copilot.py`, `test_matrix_copilot_legacy.py`, `test_matrix_mcp.py` — 63/63 pass against local PostgreSQL. Live HTTP (8019/8049) confirmed owner-scoped snapshots, cross-owner selection 404, revoke 404, and revision-bound review.
- [x] **Observations and playbooks:** DB-only peer/classification/common-period preparation; four sector-specific question sets; stored-record locators, decimal formatting, derived lineage, strict denominator/unit/basis eligibility. Prove signed percentage parity, missing-versus-zero and non-comparability; do not substitute reserves/loans for NPL coverage or equity/assets for CAR.
  Observed: four real builders on controlled stored rows (non-financial 20 cells, bank 20, insurer 18, securities 18; states `supported`/`unavailable`/`non_comparable`). Signed parity `value "-1.2"` / `display "-1.20%"` for `revenue_yoy`. Unsupported sector metrics stay unavailable.
- [x] **Widget and viewport:** register `research_matrix` as Matrix in existing library/types/layout. Implement explicit Create and clearly marked fixture mode, pinned company, density, bounded resize, filter/sort/stable selection, table disclosure, keyboard navigation, dimension inspector and responsive Result/Evidence/Basis/Review inspector. Prove no create/provider calls from view changes and no protected content in localStorage/export runtime.
  Observed: reachable in the live browser through Widget Library → AI & RESEARCH ("MATRIX", 24×16); adding it creates `[data-widget-type="research_matrix"]` and lazy-loads without crashing. `src/lib/matrix.test.ts` + `MatrixWidget.test.tsx` 8/8 pass; frontend typecheck and build pass. Persistence is `widget.config.matrixView` only (density/filter/sort/pinned/widths/hiddenDimensions/snapshotRefs); no protected values are written.
- [x] **VniAgent handoff:** stage a human-reviewed draft from selected result IDs; Send submits a typed selection. Server reauthorizes and supplies only frozen selected values and their evidence to the existing model context, without latest-data symbol inference or three-symbol truncation. Prove denied refs stop before LLM invocation.
  Observed: `/matrix/selection` returns 200 with references-only `request_text` ("References only; resolve with owner authorization. No trading or execution is authorized."); no displayed value leaks into it. Legacy forged `matrix_selection` context rejected 422; unrelated client context still streams 200; cross-owner selection 404.
- [x] **External MCP handoff:** read-only tools resolve the same snapshot/selection using per-request authenticated user identity, never a token in tool arguments. Preserve existing shared-bearer market tools but do not let that token grant Matrix access. Verify through official Python MCP `ClientSession` HTTP transport with owner/other-user/revoked cases. No claim of universal hosted-client OAuth interoperability. External data export requires explicit source-rights policy; default-deny unapproved real provider sources.
  Observed: official Python SDK `ClientSession` over streamable HTTP at `/mcp`. Owner call resolves and returns the frozen typed packet (canonical `metric.display`, not a text-serialized number). 17 tools exposed, zero mutating. Other user → "Matrix selection not found"; shared deployment bearer → "Matrix requires a verified user JWT over HTTP; shared bearer and stdio cannot authorize it"; unauthenticated transport → 401. Source-rights gate denies unapproved suppliers, including configured `family:unknown` deny sentinels.
- [x] **Integration validation:** run focused Jest/pytest contracts, TypeScript/lint and project gate after module integration. Fix actual regressions without overwriting sibling-session changes; record unrelated blockers separately with evidence.
  Observed: the integrated resplit branch passed all nine `pnpm run ci:gate` steps (frontend lint, typecheck, changelog generation/check, build, tests; backend Ruff, compile, tests). Backend result: 970 passed, 1 skipped, 3 warnings. Earlier focused Matrix runs: API 63/63 and web 8/8. The two historical gate failures below are resolved.
- [x] **Runtime proof:** run actual local API/database and registered browser widget; capture desktop/narrow inspector behavior, selection/copy/review and real persisted snapshot retrieval. Exercise actual MCP transport and VniAgent context admission with no paid provider call. Distinguish controlled seeded serving observations from live corpus and actual model generation.
  Observed: real uvicorn API on the smoke database (8 controlled MXA–MXH issuers, two fiscal years, four sector families); no LLM provider called. Scripted Chromium fixture interaction exercised Result/Evidence/Basis/Review, arrows, Space selection, Enter inspection, Escape closure and focus restoration to cell `0:0`. At 390px the inspector was a fixed 374×828 modal sheet inset 8px; selection survived resizing. These are synthetic-fixture UI observations, not production evidence.
  Manual-copy fallback was subsequently exercised in Chromium with the application-realm Clipboard API removed: the read-only textarea appeared and selected all 835 characters on focus. Snapshot/result references were present; displayed financial values were absent. This used a saved controlled non-synthetic snapshot, the actual server `_request_text` formatter, stub authentication and intercepted API responses because the local API was no longer running. It proves the browser fallback, not live authentication/database integration.
- [x] **Delivery evidence:** existing Matrix changelog entry and canonical widget documentation cover implementation and deployment/auth/source-rights prerequisites. Local repository verification is complete; production and product release gates remain open. Temporary in-repository verification scaffolding was removed. Evidence is mapped to #42; fixture/replay proof does not close the full-loop release gate.

## Resolved gate failures and integration boundary

1. Tracked `apps/web/src/data/changelog.generated.ts` was regenerated; the final gate passed generation and byte-consistency checks.
2. Prediction-market empty-state copy and its consuming test no longer fail the final gate. This is a prediction-market concern, not a Matrix evidence feature.

The inspected resplit history separated Matrix (`8160773`), prediction-market services (`a60fe2e`) and backup (`ae1ae7e`), with shared plumbing (`2e1447e`) and workspace integration (`3fdc802`). The workspace commit still includes non-Matrix files; do not treat the entire branch as a Matrix-only patch. Concurrent sessions changed branches during verification; review immutable commits and use separate worktrees rather than switching a shared checkout.

### Remote PR checks

[PR #61](https://github.com/Kohnnn/vnibb/pull/61) is the existing delivery PR.
The local gate above is not a claim that hosted checks passed. In GitHub Actions
run `36256058406`, all three Python-dependent jobs stopped during dependency
installation: public PyPI could not resolve `vnstock>=4.0.4,<4.1`. The vendor index
lists vnstock 4.0.8/4.0.9, but only vnai 2.6.2, outside the current `>=2.4.0,<2.5`
constraint. Adding an extra index alone is not a validated repair. Provider-runtime
migration and package-source trust require separate verification; do not bypass
the failure or claim a clean public-index install from an existing local venv.

The configured `vnibb-web` Vercel preview passed. The separate `vnibb` project
failed for missing `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`; its preview
environment contains no variables. Neither deployment settings nor provider
dependency constraints were changed as part of this Matrix documentation handoff.


## Shared interfaces and file ownership

Backend: `schemas/matrix.py`, `services/matrix_service.py`, `api/v1/matrix.py`, router and backend contracts. Observation builder: `services/matrix_observations.py`, `matrix_playbooks.py`. UI: `types/matrix.ts`, `lib/matrix.ts`, `MatrixWidget.tsx`, matrix UI subcomponents and registry/catalog/layout. Handoff: active `lib/api.ts`, `AICopilot.tsx`, backend `copilot.py`, MCP server. Parent integrates shared contracts and owns final checks/docs. Agents do not run mid-flight formatters/build/tests.

Wire envelope `matrix-v1`: immutable matrix/snapshot/result IDs and revision; entities/dimensions/cells; numeric metrics with canonical decimal `value` and `display`; separately resolved evidence; explicit state/basis/limitations. Selection is `{snapshot_id,result_ids}` and never accepts browser-supplied values as authority. `/api/v1/matrix` owns fixture/playbooks/prepare/snapshot/evidence/selection/review/revoke. Cross-client resolution reuses the same selection service.

## Release limits, not fake completion

No PDFs/OCR/ingestion, arbitrary integrations, custom column authoring, schedules, autonomous per-cell execution, Office/Tick-and-Tie, new provider router or new chat application. Financial sector sources must earn eligibility per metric. Deployment, authentic end-user identity configuration, live corpus completeness, source display/export rights and a user's chosen external conversational client require evidence separate from repository implementation.
