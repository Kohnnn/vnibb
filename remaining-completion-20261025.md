# Remaining-ticket completion

Scope: all 18 currently open tickets; integration branch `codex/111-remaining-completion-20261025` from reviewed main `6c921bae44b7486ff776d414a5e0df2bc6db1eec`. Preserve unrelated original-checkout Matrix readability files. No source entitlement, operator identity, historical input or human approval is invented.

- [x] Reconcile current issues/PRs and previous QA; 18 open issues, no open PRs, original checkout has no unique commits beyond main.
- [x] Measure cloud-01 PostgreSQL/Mongo performance. PostgreSQL indexed reads took 0.094–3.701 ms; no further PG tuning was justified. Applied only existing-bootstrap Mongo `idx_tradeDate_desc` and `source_1_tradeDate_-1` sequentially (15.074/20.096 s); global/source freshness no longer collection-scans. Added 104,906,752 index bytes; document count/logical size and eight container identities unchanged.
- [ ] Verify/fix Matrix #90–#93 and exact-or-unavailable regulatory #96; prove owner/revocation/revision and typed-cell behavior without provider calls or implicit AI submission.
- [ ] Finish admin #81 with verified operator authority, negative cases and actual cutover evidence; never grant a role from client metadata.
- [x] Recovery #31: fresh off-source-host restore passed (164.9 s restore, 689.267 s transfer; 855.130 s total), with 42 PostgreSQL tables and 17 Mongo collections verified. An additional encrypted copy and independent recovery identity on the existing deploy-01 account passed distinct-machine streaming decrypt in 419.281 s; full ciphertext and all three plaintext member hashes/sizes matched. Custody directory/identity are 0700/0600; no archive or plaintext persisted there. This proves separate-host/store recovery, not a separate human holder or credential-compromise independence.
- [x] Verify prediction lifecycle #32: native scratch dry-run/archive 2+1/restore 2+1 preserved full state hash, nine protected rows, and checksum/confirmation safety gates. Production read-only dry-run found zero eligible terminal rows under the existing 365-day policy; no production archive ran.
- [ ] #129 remains source-gated: 946/1,519 current, 518 older, 55 missing/unqualified. Three approved single native reads returned October 19, October 9 and August 7 bars, not October 23. No price writes, denominator filtering or threshold changes. #106 recovered October 8 FY/TTM and June 15 VNM snapshot/DCF inputs, correcting previous blanket absence claims; original October 7 runtime/unit chains, peer cohort and quant request/series remain unavailable.
- [x] #40/#48: user accepted bounded desktop/mobile interaction evidence (23 fresh Chromium checks), including internal mobile horizontal scrolling; no all-device/auth/market certification. User explicitly keeps #42/#35 external conversational-client release gated.
- [ ] Run focused regressions, typechecking, full suites once, actual runtime smoke and independent review; fix actionable findings.
- [ ] Commit related changes, merge reviewed work into main, deploy applicable OCI API/MCP/scheduler with retained rollback, verify health/logs/critical reads and publish exact ticket dispositions.

Current cloud read: application services still identify `6c921bae44b7486ff776d414a5e0df2bc6db1eec` / OCI `81029884e79a6095071fbab34493d0703495ace6e4318d0168c5746b222acc0f`; all eight retained containers running, health checks healthy where configured. Disk 94 GiB available; memory/I/O PSI zero. This is not proof of recovered current-session coverage. Private receipts: `/home/compute_01/.config/vnibb/remaining-completion-20261025/`.

## Verification and security decisions

Final full gate passed in 628.9 s: frontend lint/typecheck/changelog/build, 178 Jest suites (1,391 passed, one skipped), changed-line backend Ruff/compile and backend pytest (3,694 passed, 45 skipped, four subtests). Retained warnings: four pre-existing unused ESLint directives, React test `act` warnings and one NumPy divide warning. Standards and specification rereviews both passed with all reported findings resolved. This is source verification, not deployment acceptance.

User accepted complete-or-reject HTTP `413` for oversized frozen selections instead of partial evidence. Source rights remain default-deny; a complete citation is not a redistribution grant. Three independent code-review defects were fixed: nested regulatory links, older Mongo overriding newer SQL closes, and MCP losing `evidence_not_found`; explicit comparability state also replaces parsing English basis text.

User authorized separate rotation of admin automation, Apps Script and MCP credentials while keeping interactive admin locked. No operator is silently promoted. External clients must receive their respective scoped credentials through private custody; old exposed credentials must never be restored during image rollback. Rotation/deployment remain pending actual release evidence.

## Prediction-query acceptance follow-up

The isolated current production snapshot contains 87,553 prediction markets,
79,704 active. At its explicit October 24 fixture clock, 10,858 are eligible,
including 10,000 Kalshi rows. Actual execution exposed a remaining defect:
the shared 1,000/source candidate limit ran before topic filtering/aggregation.
Issue #33 was reopened; cutover stopped before credentials or serving images
changed. Calibration now applies eligibility/topic filtering before its requested
limit; spread/cross-calibration aggregate all eligible rows in SQL. Other
candidate-policy callers and response contracts are unchanged.

The late-CPI regression failed before and passed after. Both independent review
axes passed. Against the same isolated PostgreSQL snapshot, five request shapes
each ran three times, with EXPLAIN ANALYZE and transferred-row counts. The fixed
source overlay matched an independent unrestricted 10,858-row column-projection
reference for all five shapes; the prior image disagreed for Fed calibration,
spread and cross-calibration. The actual historical full-ORM implementation hit
the declared five-second SQL timeout in all three paths.

All 15 fixed requests met the predeclared five-second and 256 MiB incremental
client-memory budgets; the largest observed increment was 4.13 MiB. Calibration
transferred 2/25/0 CPI/Fed/recession rows, aggregates four source rows. These are
ARM64-under-QEMU measurements on the 87,553-row restored snapshot, not native
production latency or proof at the historical 13.3-million-row ceiling. The
fixture clock makes retained rows eligible and does not certify current health.
Exact final-image replay and deployment acceptance remain required.

Private plans, before/after timings, memory and semantic-reference outputs:
`prediction-scale-4-20261025T124500Z/` under the existing private evidence root.
