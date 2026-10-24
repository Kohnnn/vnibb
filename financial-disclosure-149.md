# Financial statement availability disclosure — #149

Explain withheld financial values without weakening admission or changing source data.

- [x] Reproduce the live FPT blank-table/reason mismatch and retain its actual response and DOM.
- [x] Extend the existing unavailable-note helper for nested field metadata, preserving usable partial rows and genuine zero.
- [x] Show compact reasons in statement widgets and remove unsupported blanket source-unit/reporting-standard claims.
- [x] Run the focused regression, frontend types/lint/full suite and native rendering smoke; obtain independent Standards and Spec review.
- [x] Commit/push the scoped changes to the existing integration branch and stage the exact archive on Vercel without moving aliases.
- [ ] Exercise the staged financial surface, promote that same READY deployment, and verify both aliases plus unchanged backend identities.

The later cross-session completion request adds the existing #148 prediction-progress and #150 heatmap patches to the final integration and backend release. Source certification/backfill, verified-Universe recovery and merging PR #137 into main remain outside this release. Keep the current backend and frontend available for rollback. #105 and #107 retain their broader unresolved acceptance criteria.

Verified source `596814e11ac7dee174a266615c00263110433db7`, archive SHA-256 `608eebd57905046037a96486c52409207b429d53c8431070e6085d1930d76e3b`: 49 focused tests, 178 frontend suites / 1,382 tests, TypeScript and seven-file ESLint passed. One existing opt-in test remains pending. Independent Standards and Spec reviews are clean. Staged deployment `dpl_E74heXVpyHFJ574NNGHGYS2YTFZF` rendered actual FPT field-period warnings without changing the three native statement tables; chart view retains the warnings. Current EPS is unavailable on both frontends, so no populated EPS rendering is claimed. Production promotion remains gated by coordinated backend acceptance and final verification.
