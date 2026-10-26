# Remaining-ticket completion

Scope: the 18 open tickets at initial reconciliation; integration branch `codex/111-remaining-completion-20261025` from reviewed main `6c921bae44b7486ff776d414a5e0df2bc6db1eec`. Preserve unrelated original-checkout Matrix readability files. No source entitlement, operator identity, historical input or human approval is invented.

- [x] Reconcile current issues/PRs and previous QA; 18 open issues, no open PRs, original checkout has no unique commits beyond main.
- [x] Measure cloud-01 PostgreSQL/Mongo performance. PostgreSQL indexed reads took 0.094–3.701 ms; no further PG tuning was justified. Applied only existing-bootstrap Mongo `idx_tradeDate_desc` and `source_1_tradeDate_-1` sequentially (15.074/20.096 s); global/source freshness no longer collection-scans. Added 104,906,752 index bytes; document count/logical size and eight container identities unchanged.
- [x] Verify/fix Matrix #90–#92 and the changed #93/#96 safety contracts: 52 genuine current-issuer runtime checks and all 11 final immutable desktop/mobile browser criteria passed, including owner/revocation/revision and exact typed-cell evidence. Positive AI transfer (#93) and issuer regulatory research (#96) remain explicitly gated.
- [ ] #81: three server credentials were rotated during the actual OCI cutover; 30 live scope checks passed, including old-key rejection, new own-scope success and cross-scope denial. Interactive admin remains locked by user decision (`ADMIN_USER_IDS` empty); verified-operator unlock/draft/publish/reload acceptance remains open.
- [x] Recovery #31: fresh off-source-host restore passed (164.9 s restore, 689.267 s transfer; 855.130 s total), with 42 PostgreSQL tables and 17 Mongo collections verified. An additional encrypted copy and independent recovery identity on the existing deploy-01 account passed distinct-machine streaming decrypt in 419.281 s; full ciphertext and all three plaintext member hashes/sizes matched. Custody directory/identity are 0700/0600; no archive or plaintext persisted there. This proves separate-host/store recovery, not a separate human holder or credential-compromise independence.
- [x] Verify prediction lifecycle #32: native scratch dry-run/archive 2+1/restore 2+1 preserved full state hash, nine protected rows, and checksum/confirmation safety gates. Production read-only dry-run found zero eligible terminal rows under the existing 365-day policy; no production archive ran.
- [ ] #129 remains source-gated: 946/1,519 current, 518 older, 55 missing/unqualified. Three approved single native reads returned October 19, October 9 and August 7 bars, not October 23. No price writes, denominator filtering or threshold changes. #106 recovered October 8 FY/TTM and June 15 VNM snapshot/DCF inputs, correcting previous blanket absence claims; original October 7 runtime/unit chains, peer cohort and quant request/series remain unavailable.
- [x] #40/#48: user accepted bounded desktop/mobile interaction evidence (23 fresh Chromium checks), including internal mobile horizontal scrolling; no all-device/auth/market certification. User explicitly keeps #42/#35 external conversational-client release gated.
- [x] Run focused regressions, typechecking, full suites once, actual backend runtime smoke and independent standards/specification review; resolve actionable source findings. Matrix-specific final browser acceptance is recorded separately below.
- [x] Commit related application changes, merge reviewed work into main, deploy OCI API/MCP/scheduler with retained rollback, verify health/logs/critical reads, promote the accepted immutable frontend and publish exact ticket dispositions. The final evidence-only documentation follow-up stays unmerged.

OCI cutover completed at `2026-10-25T13:06:11.222029Z`: API, MCP and scheduler serve main `5926854968f9359f7d8192fbe603924615311755` / immutable image `sha256:5f3c511f3aa1c24db759988fbc2d3309247982dbac53e438209557956d097791`. Auth/PostgreSQL/Mongo/Redis identities stayed unchanged; Caddy retained its image/config/mounts. Serving proof after at least 300 seconds and protected-eight capture passed; retention resumed with old/new/promised images retained. API/MCP had no observed errors/5xx; scheduler retained two scheduled PredictIt HTTP 403 errors. This is not proof of recovered source coverage. Private receipts: `/home/compute_01/.config/vnibb/remaining-completion-20261025/`.

## Verification and security decisions

The final prediction-fix full gate passed in 488.3 s: all nine configured steps, backend pytest (3,695 passed, 45 skipped, four subtests), with the unchanged frontend suite previously passing 178 suites (1,391 passed, one skipped). Hosted CI run `40193712277` passed all four jobs. Standards and specification reviews passed. Retained warnings: four pre-existing unused ESLint directives, React test `act` warnings and one NumPy divide warning. These are source checks, not deployment acceptance.

User accepted complete-or-reject HTTP `413` for oversized frozen selections instead of partial evidence. Source rights remain default-deny; a complete citation is not a redistribution grant. Three independent code-review defects were fixed: nested regulatory links, older Mongo overriding newer SQL closes, and MCP losing `evidence_not_found`; explicit comparability state also replaces parsing English basis text.

User authorized separate rotation of admin automation, Apps Script and MCP credentials while keeping interactive admin locked. Rotation and its 30-check native acceptance passed on 25 October; no operator was promoted. Scoped secrets remain in root-only private custody; external client delivery/reconfiguration is not claimed. Image rollback must retain the new credentials, never restore exposed old keys.

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
The final immutable image `sha256:5f3c511f3aa1c24db759988fbc2d3309247982dbac53e438209557956d097791` at main `5926854968f9359f7d8192fbe603924615311755` also passed five real service/SQL requests without a source overlay. All matched the unrestricted reference within the declared budgets (3.577/0.455/0.305/2.283/0.555 s). Native production HTTP and serving acceptance are recorded separately; this QEMU replay does not prove native latency or current market coverage.

Private plans, before/after timings, memory and semantic-reference outputs:
`prediction-scale-4-20261025T124500Z/` under the existing private evidence root.

## Native release acceptance

All five native prediction-analysis GETs returned HTTP 200 in 0.399–0.759 s; the recession result preserved the genuine zero-market/null-consensus state. [#33](https://github.com/Kohnnn/vnibb/issues/33#issuecomment-6398251003) closed on the bounded-equivalence evidence. This does not prove market-topic correctness: live CPI/Fed responses exposed pre-existing substring false positives (`LFCPIT`, `headliner`, `Federico`, `federally`), separately recorded in [#161](https://github.com/Kohnnn/vnibb/issues/161). The unrestricted-reference comparison preserves that existing topic policy; its taxonomy defect is not disguised as a resource-safety success.

The A/B/D/E/F/G acceptance ledger records actual four-fault restore verification, separate PostgreSQL-backed worker/API transitions, partial/complete Universe behavior and nine HTTP requests with 25 assertions. Ten relevant final-image modules exactly matched the previously exercised image; API fault scenarios were not rerun against serving production. Six response branches were also exercised in the final immutable staged UI. These explicit boundaries keep map #24 open pending its literal post-deployment fault-scenario gate.

Detailed production health remains `degraded`: no verified complete screener Universe, expected session `2026-10-23`, and an explicitly unverified exchange calendar. Basic API/MCP health and stable containers do not override that data-freshness failure or close #129.

## Matrix acceptance boundaries

The completed full gate includes named reference-field/precision, missing-evidence versus outage, owner denial, immutable review/version, unsafe denominator, period/unit/basis and classification regressions. The frontend suite covers latest common fiscal year after shortlist edits, preserving an explicit valid year, and view controls that do not create research. Final genuine current-issuer acceptance passed 52/52 runtime checks and all 11 desktop/mobile browser criteria on immutable deployment `dpl_7YD7szvSSqTiYzS7pVdfLNepuacf`: two ordinary users, two native versions, one review, exact retained VNM references, eight honest bank-regulatory unavailable metrics, explicit unsent draft, local-only imported refs surviving reload, owner revocation and API/MCP denial afterward. The browser issued zero snapshot creates, cloud writes or copilot sends, with zero forbidden mutations or page errors. All five owned Matrix rows and both disposable accounts were removed; global logout returned 204, account absence 404, and owned browser processes were absent. Evidence: `matrix/remaining-matrix-20261025T142811Z-5926854968f9/` under the private root. Failed harness attempts remain preserved, not relabeled passed.

Frozen selections use complete-or-reject bounds: 1–120 unique result IDs and at most 524,288 UTF-8 JSON bytes; oversized complete context returns HTTP `413`, never silently truncated evidence. Source rights remain default-deny. A native unsent draft can prove the changed UI boundary without closing #93's positive human Send/authorized transfer gate; safe regulatory unavailability cannot close #96's issuer-evidence research.

## Final frontend promotion

Both `https://vnibb-web.vercel.app` and `https://web.vnibb.xyz` now identify immutable deployment `dpl_7YD7szvSSqTiYzS7pVdfLNepuacf`, bound to reviewed main `5926854968f9359f7d8192fbe603924615311755` and source archive `20f00a9dd3a4535db8452e5a86116a330388d2acdbe05c330e7d1f8a4d99b398`. All six readiness/liveness/health HTTP requests returned 200; health bodies correctly remain `degraded`. Sixteen immutable asset paths and hashes matched both aliases, all eight backend containers were preserved during promotion, and no rollback ran. Safe receipt: `release/final-592685-production-release.safe.json` under the private root.

Application release acceptance is not research-data acceptance. #24 retains its literal serving fault-scenario gate; #35/#42 retain the named external-client gate; #81 remains locked; #93 positive transfer, #96 issuer mapping, #106 original numerical lineage and #129 certified current Universe remain open. The separate topic-admission defect is #161. Evidence-only documentation commits are not deployed application revisions; keep the final documentation PR unmerged to avoid an automatic main-branch frontend build replacing this accepted deployment.

## Published ticket dispositions

Final publication posted 12 evidence comments and closed [#90](https://github.com/Kohnnn/vnibb/issues/90#issuecomment-6399023783), [#91](https://github.com/Kohnnn/vnibb/issues/91#issuecomment-6399024202) and [#92](https://github.com/Kohnnn/vnibb/issues/92#issuecomment-6399024720) as completed, preserving their original bodies. The [parent QA disposition](https://github.com/Kohnnn/vnibb/issues/111#issuecomment-6399026769) records the exact remaining gates. One final read-only tracker list verified 10 open issues: #24, #35, #42, #81, #93, #96, #106, #111, #129 and #161. Safe receipt: `tracker-final-publication-20261025.safe.json`, SHA256 `f66a013c19d89b2e70431493e68da6377d31f9af44a6b78bc4e0dcb0186480eb`. Independent final documentation/evidence review found no blocking findings; no additional application check or deployment was run for this documentation-only follow-up.

## 26 October continuation: genuine readiness and final main rollout

The user now authorizes merging the related work, including the evidence-only PR, and a new OCI/frontend rollout. The earlier instruction to leave that PR unmerged applies to the previous accepted deployment, not this newly requested release. Reconfirmed choices: keep interactive admin locked, external conversational-client release gated and the no-send policy. #35/#42/#81/#93 remain bounded by those choices.

- [x] Reconcile all 10 remaining tickets and actual cloud-01 stores. Fresh indexed PostgreSQL reads took 0.072–3.602 ms; Mongo latest reads examined one key/document. No blocking work or memory/disk pressure justified DB tuning. Proposed event/news NULL lookup optimization was retracted: the queries were historical counters with zero new calls, not current application code.
- [x] Complete #161 token/phrase admission and identified-release before/after consensus-input proof. SQLite red: two failures; focused green: 20 passed. The same new contract passed twice on a dedicated migrated PostgreSQL database. Five actual deployed GETs exclude the recorded false-positive IDs; live-corpus and spread-count limits remain explicit.
- [x] Repair OHLC source identity, stalled provider-free screener materialization and exact active-Universe certification; preserve raw data, source units, cancellation counts and all active gaps. Final OHLC/discovery/SQL-Mongo selection passed 142 tests; daily/window checks passed 49; membership checks passed 118.
- [x] Finish #24 real separate-worker/API and honest UI canary acceptance without faults on shared serving stores. Four worker outcomes and nine UI branches passed on the exact new image; the literal serving-production fault gate remains open.
- [ ] Resolve #129 with genuine completed-session observations and a full screener receipt. Baseline: 946/1,519 current, 518 older, 55 unqualified; every active latest screener snapshot is October 14. The daily owner timed out after 7,199.926 seconds in prices before reaching screener. Current-source gaps and the uncertified calendar cannot be repaired by an index or fabricated date.
- [x] Investigate reachable #96/#106 evidence. Techcombank issuer inputs and an October 3 VNM display were recovered in the existing research/QA notes; legal/method/rights and original October 7 lineage gaps remain explicit, not filled by proxies.
- [x] Run the final source gate and independent reviews, commit related changes only, merge main, publish the immutable image and redeploy API/MCP/scheduler plus frontend. Auth/PostgreSQL/Mongo/Redis/Caddy and rotated credentials were preserved.
- [x] Publish final per-ticket evidence and actual detailed-health verdict. [The final QA disposition](https://github.com/Kohnnn/vnibb/issues/111#issuecomment-6409359172) preserves ten open gates and three prior Matrix closures; application rollout does not imply research readiness.

### Current-source and pre-release verification

The initial diagnostic `getList` POST used a bare symbol array and returned an empty HTTP 200; it did not exercise the installed client contract. Read-only inspection of installed vnstock 4.0.9 established the body `{"symbols":["VNM","A32","EGL"]}`. One corrected request returned all three raw envelopes at 03:59:41 UTC: VNM had a 57,700 match and 608,400 accumulated volume; A32 had zero match/volume; EGL had exceptional-price-limit status, `ENDED`, and October 23 receive time beside an October 26 listing/trade clock. These are current intraday observations, not authoritative October 23 no-trade/session certificates. Neither request wrote data; no zero-price bar or current date was manufactured.

The changed native OHLC client then fetched two actual VNM bars dated October 22 and 23 with matching supplier symbol, converted both, and wrote nothing. This exercises the source path, not only mocked tests.

| Boundary | Failing-before / passing-after evidence |
|---|---|
| Macro admission | 2 failures before; 20 focused SQLite checks and 2 migrated PostgreSQL checks passed; native identified-release afterproof remains required |
| Source identity | 4 failures before; four-file OHLC/discovery/SQL-Mongo selection passed 139 tests |
| Active membership and inactive history | 4 failures before; selected reader/writer/health checks passed 118 tests, 25 deselected |
| Inclusive backfill window | 2 failures before; only inclusive requested dates reach either store; all-outside response is empty |
| Stalled daily prices | 1 timeout failure before; daily/window combined selection passed 49 tests; committed counts and external-cancellation behavior remain covered |
| Release adapter | Parent generated-cutover/rollback syntax self-check passed without production commands; independent safety review remains a separate gate |

The native canary's early blank heatmap screenshot was captured while retries were pending. Once the actual 503 reached its terminal state, the existing unavailable/retry branch rendered. No heatmap component or duplicate test change is required; transient loading is not recorded as a terminal defect.

Final local gate: frontend lint passed with 79 pre-existing warnings and zero errors; typecheck, production build, changelog check and all 178 Jest suites passed (1,391 tests, one skipped). The combined gate then stopped on two changed import-order diagnostics; both were fixed. Continued backend changed-line Ruff and compile passed, followed by 3,720 tests, 45 skipped, one NumPy warning and four subtests in 340.45 seconds. Standards review found an invalid-identity response classified as empty; four failing regressions demonstrated it, the client now raises an explicit validation failure, and the final four-file selection passed 142 tests with changed-line Ruff clean. Final real VNM OHLC smoke again returned the two matching-symbol October 22/23 bars without writes. No second full-backend run is claimed after that one-line correction; hosted final-head CI remains required.

Independent Standards re-review has zero unresolved findings; Spec review has no proven code defect and retains release/source evidence gates. The separate missing-application rollback/reconciliation blocker was repaired and independently re-reviewed before cutover. Image verification's rejected root registry credential was isolated with a temporary anonymous Docker configuration; existing credentials and package policy were unchanged. Failed attempts remain preserved separately.

### Final deployed evidence

PR [#162](https://github.com/Kohnnn/vnibb/pull/162) merged as `f76cb8613cc5153ff17c39660597ea3eca5d3ba0`, identical tree `98ffd6c7d1fcee9a485d3448baeae117dc6b4876` to hosted-tested `e139a4492793cc6e864026a428823ce0730a05a9`. Full archive SHA256: `9029167cc4c4ef6b9215c781071c877585c6ce6bcef45f00a4dee3bc58550c16`. Hosted CI, PostgreSQL, Chromium and secret-scan gates passed. [Publication 40270835399](https://github.com/Kohnnn/vnibb/actions/runs/40270835399) produced ARM64 image `ghcr.io/kohnnn/vnibb-api@sha256:b56d79f55610b98b929a3dcd79a052d69d9d38429345a1fb40d90a830c78c719`; 215 copied/imported source-file hashes, installed dependencies and offline `pip check` passed. Native TA/quant/MCP retained-input workloads passed with read-only SQL, zero provider calls and zero Mongo writes. These are runtime checks, not source certification.

API/MCP/scheduler cutover completed at `2026-10-26T05:37:19.866198Z`. Serving proof through `05:43:21.341401Z` covered 361 seconds, one scheduler, disabled startup population and unchanged protected services. API had zero observed errors/HTTP5xx; MCP had zero errors and 13 non-JSON lines. Scheduler retained one revision-bound prediction-ingestion ERROR for supplier caps/denials and PredictIt HTTP403. Retention resumed at `05:44:34.393461Z`, keeping the new image, immediate rollback `5f3c511f…` and older `81029884…`; no manual prune. Post-resume accepted custody precedes frontend promotion.

Both `web.vnibb.xyz` and `vnibb-web.vercel.app` now serve READY deployment `dpl_G2mTvKgscV1zaV2JXkAjTdCFqcuQ`, immutable host `vnibb-4lqchf6ml-vphk2001-gmailcoms-projects.vercel.app`. Promotion verified exact revision/archive metadata, immutable-versus-alias JS/CSS hashes and unchanged protected eight. Six frontend ready/live/health requests returned HTTP200; health bodies remain degraded. The actual canonical login form rendered without page errors; no credentials were submitted in that final public observation.

Native immutable login returned HTTP200, matched the online ordinary owner and stored session, rendered the authenticated dashboard, and logged out with HTTP204. The owned account was deleted and lookup returned404; browser processes and credentials were removed. Twenty actual loaded JS files include both new changelog strings; AI/Copilot requests and forbidden API mutations were zero. The original Node18 import failure and corrected browser wrapper's `TimeoutError` remain FAILED. The timeout's originating operation is unresolved. A separate strict offline criterion adjudication, independently reviewed without blockers, accepts only those recorded login/dashboard/no-send/changelog criteria; it does not relabel either wrapper or certify widget data. No extra auth replay was needed.

Exact new-image isolated #24 worker/API and immutable UI proof passed four outcomes, seven status reads and five scenarios/nine UI branches; owned containers/networks/scratch were removed and protected eight stayed unchanged. [The nonclosing disposition](https://github.com/Kohnnn/vnibb/issues/24#issuecomment-6409224510) distinguishes this unserved, network-blocked candidate from literal serving-production fault injection.

One finite provider-blocked screener materialization returned 1,464 writes/1,519 active, 55 unqualified, zero provider calls and verified Universe0. Original trade dates remain 946 October23, 518 older and 55 invalid: 573 source gaps. No manual Universe marker, date restamp or historical deletion occurred. [Strict watch 40275486867](https://github.com/Kohnnn/vnibb/actions/runs/40275486867) FAILED on the new revision with detailed health degraded and healthy live/ready. [#129 remains OPEN](https://github.com/Kohnnn/vnibb/issues/129#issuecomment-6409170469): completed-session observations or authoritative no-trade/session evidence and a verified exchange calendar are still missing.

[#161 deployed temporal before/after](https://github.com/Kohnnn/vnibb/issues/161#issuecomment-6409161558) removed the recorded sports/federal/Federico false-positive IDs. CPI and recession return zero/null; Fed returns nine admitted markets. Live corpus/odds changed, so this is not identical-corpus parity. Spread's repeated source totals are not topic-admitted counts; its window is informational. The issue remains OPEN with this contract limit recorded.

Matrix's genuine 52-runtime/11-UI proof retains prior identity `5926854968f9359f7d8192fbe603924615311755` / `dpl_7YD7szvSSqTiYzS7pVdfLNepuacf` / image `5f3c511f…`. Current acceptance carries forward 884 unchanged runtime/dependency files and prior frozen packets, excluding eight changed non-Matrix paths, alongside six fresh bounded route/UI/auth criteria. It is not a fresh Matrix runtime retest, future-source certification, supplier-rights grant or Send proof.

All 13 reviewed tickets retain their states: OPEN #24/#35/#42/#81/#93/#96/#106/#111/#129/#161; CLOSED #90/#91/#92. Original bounded core QA closures remain intact. Interactive admin stays locked, the named external conversational-client gate stays closed and no-send/default-deny remains. #96 legal/method/rights and #106 original numerical lineage gaps are not filled by proxies. Application rollout is complete; research readiness remains NO-GO.

Private exact-identity receipts: `release/app-release-f76cb8613cc5153ff17c39660597ea3eca5d3ba0/{verify-image,native-runtime-acceptance,cutover,backend-proof,retention-resume,accepted-backend}.json`; frontend `production-verification-summary.json`; `staged-accepted-carryforward-f76cb8613cc5.safe.json`; auth `attempt-20261026T054905Z-2d4205a8e766/criterion-adjudication.safe.json`. This documentation-only record does not change deployed application bytes.
