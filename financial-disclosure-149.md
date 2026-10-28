# Financial statement availability disclosure — #149

Explain withheld financial values without weakening admission or changing source data.

- [x] Reproduce the live FPT blank-table/reason mismatch and retain its actual response and DOM.
- [x] Extend the existing unavailable-note helper for nested field metadata, preserving usable partial rows and genuine zero.
- [x] Show compact reasons in statement widgets and remove unsupported blanket source-unit/reporting-standard claims.
- [x] Run the focused regression, frontend types/lint/full suite and native rendering smoke; obtain independent Standards and Spec review.
- [x] Commit/push the scoped changes to the existing integration branch and stage the exact archive on Vercel without moving aliases.
- [x] Exercise the staged financial surface, promote that same READY deployment, and verify both aliases plus unchanged backend identities.

The later cross-session completion request adds the existing #148 prediction-progress and #150 heatmap patches to the final integration and backend release. Source certification/backfill, verified-Universe recovery and merging PR #137 into main remain outside this release. Keep the current backend and frontend available for rollback. #105 and #107 retain their broader unresolved acceptance criteria.

Verified source `596814e11ac7dee174a266615c00263110433db7`, archive SHA-256 `608eebd57905046037a96486c52409207b429d53c8431070e6085d1930d76e3b`: 49 focused tests, 178 frontend suites / 1,382 tests, TypeScript and seven-file ESLint passed. One existing opt-in test remains pending. Independent Standards and Spec reviews are clean. Staged deployment `dpl_E74heXVpyHFJ574NNGHGYS2YTFZF` rendered actual FPT field-period warnings without changing the three native statement tables; chart view retains the warnings. Current EPS is unavailable on both frontends, so no populated EPS rendering is claimed. Production promotion remains gated by coordinated backend acceptance and final verification.

The earlier `596814e` candidate was not promoted. Its test-only successor `d08adf6fbeb154ac44274ec28aac93f1189663c1`, archive SHA-256 `36bf3b6af9de4fd8b369e31fcaf7936747d693411251fad6a698aa866df0fd06`, passed the complete gate: 3,542 backend tests and four subtests with 21 existing optional PostgreSQL skips; 178 frontend suites / 1,382 tests with one existing pending test; TypeScript, changed-file ESLint and actual prediction/heatmap fixture smoke. Runtime bytes are unchanged from the reviewed candidate.

At `2026-10-24T04:06:20Z`, both aliases served promoted deployment `dpl_DhmJPV1hFRJ56Z3nw6AbvrRPKwgC` with all 16 immutable assets bound to that archive. Six health requests returned HTTP 200; the health body remains truthfully degraded. The frontend operation preserved the separately accepted backend cutover's eight IDs/images/revisions and retained rollback `dpl_B3TzhVppai1NkkgguNBSHbK9h6bG`. Actual production FPT browser proof confirmed exact field-period reasons and unchanged three statement tables without unsupported source-unit/VAS claims. Private production receipts are `financial-disclosure-20261024/release-d08adf6fbeb154ac44274ec28aac93f1189663c1/production-verification-summary.json` and `combined-finish-20261024/final-d08adf6fbeb154ac44274ec28aac93f1189663c1/frontend/production-native.json` under `~/.config/vnibb/`. This evidence-only update changes no application bytes.
