# Historical session coverage and document routing

Snapshot: 2026-11-17. This index preserves the history considered for the handoff; it is **not a live backlog or permission to execute historical commands**. Start execution with [the continuation prompt](AI_CONTINUATION_PROMPT.md) and [the VniBB handoff](VNIBB_VNSTOCK_CONTINUATION_HANDOFF.md). Datalake work belongs to its [separate repository handoff](https://github.com/Kitkitkittt/vietcap_datalake/blob/codex/1498-research-journey-handoff/VCIDataPlatform/docs/research-brain/RESEARCH_JOURNEY_CONTINUATION_1455.md).

## Coverage and limits

- Enumerated both current and former stockscreen project locations: **43 returned session records** (35 current-location, 8 former-location). Project totals also counted one omitted empty session at each location; those two were not returned by the non-empty session API and are not reviewed.
- Read the available **170 recaps and 169 prompt samples** returned by session detail calls, requesting the latest ten prompts per session. These are summaries/samples, not all raw messages. Four returned records had neither recap nor prompt; they are included below rather than omitted.
- Targeted read-only transcript scans inspected session ancestry and selected user/terminal-assistant text in the four no-summary sessions and the active cross-repo session. Tool results, thinking, credentials and raw transcript bodies were excluded from publication. This resolves several fork relationships, not full transcript coverage.
- Parent searches of cross-project prompt metadata for `vnibb`, `vietcap_datalake` and `vci-datalake` returned no additional out-of-project hits within the bounded queries. Unrelated Gampo, BroodWar and other projects were not consolidated into these repositories.
- A recap can lag its own session, and a session can contain multiple repositories. Live issue/PR state, exact commits and source-bound receipts override dated summaries. A historical deployment, key test or approval does not establish current data rights, installed-host admission or release readiness.
- Raw sessions, historical plans, captures, failed results and immutable evidence were **preserved**. This cleanup consolidates navigation/current instructions; it does not delete history, rewrite failed outcomes, or assert the raw history was exhaustively reviewed.

## Canonical routing and historical-document disposition

| Material | How the next AI should use it |
| --- | --- |
| [VniBB continuation handoff](VNIBB_VNSTOCK_CONTINUATION_HANDOFF.md) | Current source/data/migration and acceptance entrypoint; refresh live refs before execution. |
| [Cross-session ledger](../project-work-backlog.md) | Detailed VniBB workstream/ticket map; preserve issue ownership and reconcile against current GitHub. |
| [Continuing-work evidence](CONTINUING_WORK_EVIDENCE_2026-11-10.md) | Dated implementation/verification evidence, not a competing live checklist. |
| [Portable DNSE preservation](evidence/continuation-20261116/README.md) | Recover exact local-only source only by its recorded checksum/base procedure; not runtime integration or source authorization. |
| Historical root QA/recovery/branding plans | Keep as dated rationale and receipt references. Use the canonical ledger/handoff for next actions instead of replaying old commands. |
| Datalake continuation handoff and its immutable evidence links | Own research journey, report/benchmark evidence, controller packaging and installed-runtime gates; do not mix issue numbers or data rights with VniBB. |
| Global skills and sibling apps | Context only; no app migration, cleanup, installation or deployment inferred. |

## Session index

Counts are recap entries / prompt samples. Titles and workstream notes are sanitized summaries. Rows classify history, not proof of current completion. All dates below are 2026; `Current` and `Former` identify archive locations, not live repo status.

| Session ID | Created | Location | Title | Recaps/prompts | Workstream / disposition |
| --- | --- | --- | --- | --- | --- |
| `01a1e274-ffbf-712e-86d7-b6acb67185d1` | 2026-11-16 | Current | VNST: Consolidate Chat Histories Into Repo Handoffs | 2/4 | Cross-repo migration, datalake journey and CI; current summaries are not latest state |
| `01a1e829-4fb0-7410-95fa-016500a2daf5` | 2026-11-17 | Current | VNST: Prepare Datalake and VNIBB handoffs | 0/0 | Handoff fork of 01a1e356; selected terminal message confirms PR265 recovery fix 0a57e874 |
| `01a1ca68-7a80-77e1-ac9c-9dad69d935dd` | 2026-11-11 | Current | TODO: Check PR263 merge readiness | 7/10 | VniBB canonical backlog, QA acceptance and PR263 integration |
| `01a1e356-28db-7244-8d9a-c46b5943dbcc` | 2026-11-16 | Current | VNST: Prepare Datalake and VNIBB handoffs | 2/0 | Prior repo handoffs: datalake PR1501 and VniBB PR265 |
| `01a1e828-f77e-7735-89c1-619eb71b928c` | 2026-11-17 | Current | VNST: Finish /skill:implement All | 0/0 | Fork of 01a1e274; selected terminal message records PR1520 acceptance, not promotion |
| `01a1a7a9-b4b1-72cb-99b8-e4ccb3b8a462` | 2026-11-04 | Current | GRANT: Implement Remaining Tickets #168–#173 | 5/7 | Source rights and recovery #168–#173 |
| `01a1a7a9-c134-72d9-ae62-979e81cddbe0` | 2026-11-04 | Current | VNIBB: Review VNIBB production QA reports | 1/2 | QA defects #205–#209; reconcile against later merges |
| `01a1c4f3-77ff-7672-b8f8-00bd004e4ce5` | 2026-11-10 | Current | TODO: Consolidate Project Sessions Into Backlog | 1/4 | 67-task/eight-workstream historical consolidation; use current ledger |
| `01a1be8a-13fd-7763-941a-f5422e906430` | 2026-11-09 | Current | GRANT: Verify Price Widget Layout Fix | 6/10 | Provider options, OTP constraints and DNSE; key success is not source permission |
| `01a1c4f3-b767-76c8-9605-9504ca57c70b` | 2026-11-10 | Current | OCI: Fix VNIBB Database | 0/0 | Infrastructure-security fork of 01a1bffa; Mongo/Redis argv repair history |
| `01a1c4f3-86c8-7029-8257-10a2e3b18c4e` | 2026-11-10 | Current | GRANT: Verify compact widget and DNSE safety | 0/1 | Compact widget/DNSE continuation; prompt alone establishes no result |
| `01a1bffa-b3fc-713f-9996-46b0b4e24aa8` | 2026-11-09 | Current | OCI: Fix VNIBB Database | 4/6 | Mongo/Redis credential hardening and dated infrastructure work |
| `01a1c317-7d15-7185-b227-3f8067e45229` | 2026-11-10 | Current | VNIBB: Finalize Repairs and Publish PR | 1/3 | UI/UX PR237 and iframe keyboard-boundary acceptance |
| `01a1aff9-7f33-732c-9353-f57e01b273c1` | 2026-11-06 | Current | GRANT: Fix percentage status invariants | 5/5 | Percentage invariants and source-gated database recovery |
| `01a1a1f8-15c7-7324-8e5a-5eb5354029d6` | 2026-11-03 | Current | BRAND: Complete Vnstock parity and recovery | 5/3 | Brand/vnstock parity/recovery history; no current production proof |
| `01a19b08-4bba-7009-87e5-da5fefbe1fbf` | 2026-11-02 | Current | BRAND: Fix contrast and Big Flow coverage | 4/4 | Brand/contrast/Big Flow and mobile navigation fixes |
| `01a19a72-d785-7799-9b49-6e65159a39d9` | 2026-11-02 | Current | DATA: Review Remaining QA Findings | 1/1 | Database readiness and qualified no-trade session receipts |
| `01a18f5f-2e9f-7702-9b11-3b731b2e153e` | 2026-10-31 | Current | DATA: Serve Current Financial Statements | 6/4 | Financial statement readers, canonical lineage and recovery |
| `01a18b90-6a70-7372-a220-d367920f407e` | 2026-10-30 | Current | DATA: Check device removal and OCI identity | 2/3 | Dated backup/restore and runtime identity evidence |
| `01a18890-09da-7205-8eae-17796ea03e9a` | 2026-10-29 | Current | DATA: Verify Offline Fix Integration | 3/3 | Offline readiness integration; source/storage/display rights separate |
| `01a16f0c-432e-74d6-871a-b911557dae13` | 2026-10-24 | Current | QA: Finish Tickets and Optimize Database | 1/0 | QA map and database optimization history |
| `01a1812e-732f-70e6-806e-b64b184fe32f` | 2026-10-28 | Current | DATA: Implement All Recovery Plan Steps | 1/1 | Recovery-plan integration and acceptance history |
| `01a173db-19ee-73d2-8fed-e386c74f6ab7` | 2026-10-25 | Current | QA: Optimize Database and Redeploy OCI | 2/1 | Database/OCI release history and PR166 follow-up |
| `01a167ea-1953-7634-b948-f904924cda3b` | 2026-10-23 | Current | QA: Finish QA tickets and optimize database | 4/5 | QA repairs; freshness/reconciliation remained separate |
| `01a1860f-a476-701d-8a31-2cb1b6f2bb40` | 2026-10-29 | Current | DATA: Implement All Recovery Plan Steps | 0/1 | VniBB database/vnstock prompt; no recap outcome |
| `01a17803-a140-716e-acf6-d0d9570d0133` | 2026-10-26 | Current | DATA: Check vnibb database performance | 3/4 | Read-only performance review and QA harness |
| `01a17be5-4e07-70bf-97af-ef2a41097ac3` | 2026-10-27 | Current | DATA: Compare financial statement database values | 3/3 | Financial sample parity versus admitted provenance |
| `01a177a8-ad23-76ad-9a60-3e60a983967a` | 2026-10-26 | Current | QA: Plan database readiness resolution | 2/1 | Database-readiness plan, coverage and source permission |
| `01a16764-0e94-72e5-93af-e4a5b1218fd6` | 2026-10-23 | Current | QA: Improve, commit, and redeploy app | 1/2 | Reliability and release-owner cutover handoff |
| `01a11c92-52d3-7117-b16c-02fcfe25a6db` | 2026-10-08 | Current | QA: Improve, commit, and redeploy app | 17/10 | Multi-phase QA, prediction retention and deployment history |
| `01a15841-5474-7080-a0c0-c48528403570` | 2026-10-20 | Current | QA: Improve Backend Streaming Reliability | 15/7 | Backend streaming/reliability and provider errors |
| `01a14ac2-14e2-71b7-ad57-f75e5ce5be25` | 2026-10-17 | Current | QA: Improve app and redeploy | 8/4 | QA/deployment sequence; reconcile exact dated revisions |
| `01a139c1-127e-778e-ab6e-f24be410a5fc` | 2026-10-14 | Current | SKILLS: Update Project Skills with Matt Pocock | 0/1 | Project skills request; outcome unavailable in summaries |
| `01a14789-a0eb-7172-96fc-29b270cc77d2` | 2026-10-17 | Current | SKILLS: Update Project Skills with Matt Pocock | 0/0 | Fork of project-skills session; selected scan found no user/final outcome |
| `01a1339b-09cb-70c9-abd2-6168e3b06081` | 2026-10-13 | Current | SKILL: Update Global Matt Pocock Skills | 0/1 | Global skill work, outside app runtime scope |
| `01a10f81-f5a0-7614-ab59-db39e8333887` | 2026-10-06 | Former | Check newsletter note | 2/3 | Latest-quarter provider limit/financial widget history |
| `01a1064e-c06a-7115-b826-ae624e5af950` | 2026-10-04 | Former | Fix price selection precedence and redeploy | 5/9 | Price-selection precedence and deployment history |
| `01a0e87f-dab9-7649-888d-fa9fe04ab363` | 2026-09-28 | Former | Enforce Database Write Integrity and Failure Reporting | 7/10 | Database-write integrity and Matrix history |
| `01a1005f-b971-718f-8b3c-09f549941ec7` | 2026-10-03 | Former | Check why many errors occur | 10/10 | Mixed MCP/database/UI errors; includes corrected status claims |
| `01a0eb31-3225-75a8-9358-35087cbf3807` | 2026-09-29 | Former | Check VietCap IQ API posting | 1/1 | Vietcap public POST versus unverified IQ POST; not datalake acceptance |
| `01a0dbb7-aa3e-72bd-937e-c1039a3ce784` | 2026-09-26 | Former | Verify OCI backend, database, Vercel frontend | 16/10 | Workspace/Matrix and production alignment history |
| `01a0c4ff-d120-76d7-bf85-3f79dcfff406` | 2026-09-21 | Former | Finish all recommended cleanup tasks | 12/10 | Prediction retention and operational cleanup history |
| `01a0dbb3-ede7-75e5-bc84-ff4759c48b74` | 2026-09-26 | Former | Commit Matrix changes and open PR | 5/5 | Matrix PR61 and historical CI/preview blockers |

## Durable decision history

1. **Source use and production recovery are separate from local implementation.** October/November readiness sessions repeatedly distinguish offline fixes from source permission/coverage/finality, custody, backup/restore, one daily owner and consumer/watch acceptance. Use current #168/#171/#172/#173 and related custody issues for actual disposition.
2. **Provider selection changed over time.** Early Gen6 requests required environment review, official migration instructions, approval before installation/caller edits, v5-compatible contracts, confidential key handling and explicit unsupported-feature decisions. Later retained handoff evidence records VniBB-only direct DNSE offline steps 1–4; Gen6 is an alternative, not permission to install it now. The selected raw-message scan did not independently recover every approval exchange; the canonical handoff and its cited evidence own that interpretation.
3. **No invented comparison baseline.** The user reported old validation ended on 2026-11-10. A saved baseline must have valid provenance and matching contracts; otherwise direct old/new live parity is unavailable and must be labelled.
4. **Datalake and VniBB are distinct.** The long-running cross-repo session contains datalake journey/report/CI work despite its migration title. Datalake source/installed/human evidence classes and VniBB source/recovery gates cannot substitute for one another.
5. **Forks are not new completion evidence.** The empty-summary handoff fork points to session01a1e356 and retains a terminal claim of PR265 recovery correction0a57e874; the implementation fork points to session01a1e274 and retains the dated PR1520 acceptance result. The security fork points to session01a1bffa; the skills fork to session01a139c1. Fresh refs and receipts still decide present state.

## Cleanup boundary

The current handoffs replace stale *next-action instructions*, not historical evidence. Keep checksum-bound files unchanged; annotate supersession at the navigation/handoff layer. Do not delete chat stores, worktrees, branches, raw logs, screenshots, backups or unrelated documents as part of this consolidation. A later retention cleanup requires an explicit target list and verified preservation of unique work.
