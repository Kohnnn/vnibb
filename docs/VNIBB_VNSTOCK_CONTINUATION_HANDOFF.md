# VniBB continuing work and vnstock handoff

Snapshot: **2026-11-17 08:14–08:18 UTC**. This is a transfer guide, not a new backlog or release approval. Start with [#241](https://github.com/Kohnnn/vnibb/issues/241)'s canonical [cross-session ledger](../project-work-backlog.md), its linked [implementation and QA evidence](CONTINUING_WORK_EVIDENCE_2026-11-10.md), and current GitHub issues and PRs. The [session coverage index](SESSION_HISTORY_INDEX.md) maps the recovered historical summaries; the [cross-repository continuation prompt](AI_CONTINUATION_PROMPT.md) is the single copy-paste handoff. Historical plans and retained reports are dated evidence, not proof of the present production state.

## Snapshot and ownership

- Active app repository: `Kohnnn/vnibb`. At the 2026-11-16 transfer, the original checkout was `codex/195-e2e-production-fix`, HEAD `64ee0e70bb539765e760a1914e48a2d2eb4b516b`, with modified backup script/test and `ListingBrowserWidget.tsx`, untracked Matrix/readability work, `artifacts/` and an untracked ledger. That historical state is not a current cleanliness claim. Preserve any dirty or untracked work; the untracked ledger can differ from the tracked canonical copy.
- [Issue #264](https://github.com/Kohnnn/vnibb/issues/264) owns this documentation; [draft PR #265](https://github.com/Kohnnn/vnibb/pull/265) targets `main` from `codex/264-vnibb-continuation-handoff`. At the snapshot, its remote head was `0a57e8740a0e65d5d759262f65560d378f56bbc5`, a successor to original handoff `a186816b6bd2ce30cff2752e8e02e64cf1d7406d`. Later commits may exist; inspect the actual PR and checkout before editing. On a fresh clone, fetch the existing PR branch rather than assuming a machine-local worktree path.
- The GitHub snapshot showed `main` at `13de94e526b777135c4472b000576a3f1f4a39e8`, the merge of [PR #263](https://github.com/Kohnnn/vnibb/pull/263) on 2026-11-16 06:40:37 UTC. [#241's checkpoint](https://github.com/Kohnnn/vnibb/issues/241) reports 13 passing PR CI jobs and successful main CI for the exact merge. Those are issue-reported historical receipts, not a new test or proof of deployment.
- GitHub listed 28 open issues and two open draft PRs, #265 and held [#239](https://github.com/Kohnnn/vnibb/pull/239), with no further pages at the snapshot. #239's head was `27e4c1948b71d8a9ce7ebe5b9c8af0fef2ceccf8`; preserve its source-data/history hold and do not reuse or republish its disputed material. Recheck live GitHub before assigning work.

## DNSE candidate and portability

At the 2026-11-16 transfer, local-only branch `codex/233-dnse-offline-20261116` held clean candidate `bc2c8ff20dfe2f96e5742311a834a2e31e4f467c`, parent `7d71fb4ab3491da008b1e71599f032b75301ec10`. Ordinary status then showed no tracked/non-ignored changes; ignored content was not inspected. The same-named remote branch was absent then, not necessarily now. Preserve the original checkout/object; older draft PR #239 is not this candidate.

The portable [source delta and recovery instructions](evidence/continuation-20261116/README.md) and [source-bound receipt](evidence/continuation-20261116/dnse-offline-receipt.json) are included in this documentation branch. A disposable-index check reconstructed the exact candidate tree with exit 0. The base64 encoding preserves mixed CRLF/LF; decode and verify before use. Preservation is not source promotion or deployment authority; review intervening main changes before any integration.

Historical offline results and their limits are retained in that receipt: 287 unit/compatibility and 65 disposable-store passes; the full backend run had 32 MCP harness failures, followed by a separate 43-test affected-file pass after isolation correction. No clean aggregate, new application run, live-source parity or full frontend/build result is claimed. Raw scripts/logs remain in the original ignored migration workspace and are not portable evidence here.

## Continuation receipt: 2026-11-17 isolated source recovery

This dated receipt supplements, rather than rewrites, the snapshots above; its local and unpublished states are observations from the 2026-11-17 recovery, not present-status claims. The first authorized runnable slice was **#233 portable source-recovery acceptance only**. It is complete; #233's broader adapter, semantics and live acceptance are not. Issue #233 was claimed by `Kitkitkittt`. Its local recovery binding was repository `Kohnnn/vnibb`, branch `codex/233-dnse-recovery-20261117`, base/HEAD `7d71fb4ab3491da008b1e71599f032b75301ec10`, role `offline source recovery, no promotion`, checkout `/tmp/vnibb-continuation-20261117-X9gc3y/recovered`. The recovered delta was unstaged; no new commit was created and the branch then pointed at the base.

### Reconciled identities and exercised scope

- VniBB main: `13de94e526b777135c4472b000576a3f1f4a39e8`; draft #265 head and clean documentation checkout before this receipt: `8b3afb69f0e090516a4cf94dcacb5db5a3b93ee2`. This receipt was initially an uncommitted local update to that existing handoff, not a published PR revision. PR #265's observed CI was still partly in progress; no new green CI claim is made.
- Preserved candidate: `bc2c8ff20dfe2f96e5742311a834a2e31e4f467c`; base: `7d71fb4ab3491da008b1e71599f032b75301ec10`; reconstructed tree: `5b998b80e90b39e6755af10a507a973bf72a738e`. Patch: 69,612 bytes, SHA-256 `ab9444a12396b02309e071c402a56a28661487e3adb8b67a199acb84ef73ed48`. Every one of the receipt's 13 file sizes and SHA-256 hashes matched. This establishes the tree, not a newly recreated commit or application acceptance.
- At recovery, the original dirty checkout remained at `64ee0e70bb539765e760a1914e48a2d2eb4b516b`, with its backup, listing and Matrix/readability edits preserved. The original clean offline candidate checkout and held #239 were not modified. During recovery, no existing branch was reset, rebased or merged.
- Review of the five files changed between the recorded base and main found no backend overlap. The two changelogs overlap; the ownership component/test and Vercel deployment controls contain the already merged #263 work and must be retained. A read-only `merge-tree` check exited 0 with tree `f1f4208db181c5dd136041bb046effd4fd4c9eee`. During recovery, no integration checkout or merge commit was made; conflict-free text merging is not qualification.
- Controller SHA: not applicable to this local recovery; no CI controller, hosted qualification, provider, application, database, browser or deployment entry point was exercised. Historical application results above remain historical, including the failed full-suite aggregate.

### Exact recovery checks and actual exits

Local evidence root: `/tmp/vnibb-continuation-20261117-X9gc3y`. Logs are local and not included in the published handoff; the original portable patch and receipt remain unchanged. The commands below identify the actual exercised source and paths. Do not repeat `git apply` in the already recovered checkout; a reproduction needs a fresh isolated checkout at the recorded base.

```sh
HANDOFF=/mnt/newvolume/PersonalWebsite/stockscreen/VNIBB/vnibb-worktrees/264-vnibb-continuation-handoff
EVIDENCE=/tmp/vnibb-continuation-20261117-X9gc3y
cd "$EVIDENCE/recovered"
test "$(GIT_MASTER=1 git rev-parse HEAD)" = 7d71fb4ab3491da008b1e71599f032b75301ec10
printf '%s  %s\n' ab9444a12396b02309e071c402a56a28661487e3adb8b67a199acb84ef73ed48 "$EVIDENCE/candidate.patch" | sha256sum --check
GIT_MASTER=1 git apply --check "$EVIDENCE/candidate.patch"
GIT_MASTER=1 git apply "$EVIDENCE/candidate.patch"
# Each command above exited 0; recovery-apply.txt records application/status.
```

The separate file-hash check ran the following Python body with `python3 -` from that checkout (the receipt path was the literal absolute path represented by `HANDOFF` above); exit 0, output `PATCH_BYTES=69612 FILES_VERIFIED=13 ALL_MATCH=true`, recorded in `hash-check.txt`:

```python
import hashlib, json
from pathlib import Path
receipt = json.loads(Path('/mnt/newvolume/PersonalWebsite/stockscreen/VNIBB/vnibb-worktrees/264-vnibb-continuation-handoff/docs/evidence/continuation-20261116/dnse-offline-receipt.json').read_text())
patch = Path('/tmp/vnibb-continuation-20261117-X9gc3y/candidate.patch').read_bytes()
assert len(patch) == receipt['patch_bytes']
assert hashlib.sha256(patch).hexdigest() == receipt['patch_sha256']
for entry in receipt['files']:
    data = Path(entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
print(f"PATCH_BYTES={len(patch)} FILES_VERIFIED={len(receipt['files'])} ALL_MATCH=true")
```

The tree check used only a disposable index; it did not stage the recovery worktree's real index. These commands exited 0, recorded in `recovery-tree.txt`:

```sh
export GIT_INDEX_FILE="$EVIDENCE/recovery.index"
GIT_MASTER=1 git read-tree 7d71fb4ab3491da008b1e71599f032b75301ec10
GIT_MASTER=1 git add -- CHANGELOG.md apps/api/tests/test_api/test_data_pipeline_price_sync.py apps/api/tests/test_contract/test_dnse_offline_admission.py apps/api/tests/test_core/test_dnse_port.py apps/api/tests/test_providers/test_dnse_offline.py apps/api/vnibb/core/price_units.py apps/api/vnibb/providers/__init__.py apps/api/vnibb/providers/dnse.py apps/api/vnibb/providers/market_data.py apps/api/vnibb/services/data_pipeline.py apps/api/vnibb/services/mongo_market_data_service.py apps/web/src/data/changelog.generated.ts docs/oracle_runbook.md
tree=$(GIT_MASTER=1 git write-tree)
test "$tree" = 5b998b80e90b39e6755af10a507a973bf72a738e
unset GIT_INDEX_FILE
GIT_MASTER=1 git merge-tree --write-tree 13de94e526b777135c4472b000576a3f1f4a39e8 bc2c8ff20dfe2f96e5742311a834a2e31e4f467c
```

**Non-green diagnostic preserved:** `GIT_MASTER=1 git diff --check` in the recovery checkout exited **2**, reporting trailing whitespace at `apps/api/tests/test_api/test_data_pipeline_price_sync.py:402` (`main-compatibility.txt`). Inspection found the preserved line's CRLF terminator. The exact candidate bytes were deliberately not normalized during recovery. The initial chained compatibility command stopped at that diagnostic; the separately executed `merge-tree` command above exited 0 (`merge-tree-check.txt`). This is not a clean source-hygiene claim or permission to suppress the diagnostic in a future promotion.

### Review disposition and remaining owners

Recovery disposition: **accepted for byte-identical source preservation only**. Independent bounded VniBB reconciliation found no conflicting non-provider instruction or earlier runnable prerequisite; datalake reconciliation confirmed its separate ordered gates. Their local reports are `/tmp/vnibb-nonprovider-reconciliation-E6UkTV/report.md` and `/tmp/datalake-reconciliation-20261117-W46DFL1q/RECONCILIATION.md`. No fresh behavioral review, application test, full build or release acceptance is claimed. Source promotion remains a separate exact-candidate integration/review decision under #241/#233, including disposition of the whitespace diagnostic; provider semantics remain unresolved.

For VniBB, #231's security/operator retains private containment and custody; #232/#168's source owner retains written per-source/per-use permission and coverage; #171/#172's operator retains fresh independent-custody backup/restore, bounded recovery authority and a daily producer; #173's QA/operator retains consumer and following-session watch acceptance. Unproven units, basis, finality, header semantics, financials, ratios and unmatched features remain HOLD/unavailable. No provider calls, credential/account reads, schedules, database writes, deployment, admin unlock or human Send occurred.

For datalake, the one bounded reconciliation observed main `39edb052bf3bfeaef41dbf17fb0f92b71d598101` and draft #1501 head `9e32e523432ab58e227a3f4d00b523e9fc7c8982`. Its existing handoff remains authoritative: #1494's authorized maintainer (`Kitkitkittt`) must establish admitted ARM64 routing/controller/PR-event proof; #1494/#1520's owner must recover local-only correction `09ae05e1b933c28d7e278da4429e1fefae8c0a3d` against parent `b8a6d7d7ef96100830ddd210f712358c23582b60`, then qualify/diagnose after routing. #1492 remains before #1456/#1460 acceptance, then #1462 integration and its own qualification. #1443/#1449/#1450's runtime custodian still needs disposable-host admission and a qualified immutable package. No datalake source, CI or host execution was attempted; no gate was waived and no second datalake handoff was created.

## Migration and data gates

The external parent `VNIBB/AGENTS.md` still describes vnstock 5.2.1/VCI. It remains unchanged and is not proof of Generation 6 adoption. The [preserved audit summary](evidence/continuation-20261116/README.md#prior-migration-review-not-a-generation-6-deployment) records environment-identification limits and official references. The 2026-11-16 metadata review found no Gen6 distribution in the inspected standard locations, did not run `vnstock status`, and did not install packages or call a provider. It does not establish the production interpreter. Separately, the [2026-11-13 isolated Gen6 research probe](../project-work-backlog.md#5-providers-credentials-and-source-selection) exercised import/status without Python provider dispatch, while tracing observed contained DNS attempts; that earlier probe was not a deployment or application compatibility proof.

**Choice history:** the original request was to review Gen6 migration read-only; the later approved direction selected **direct DNSE for VniBB only**, offline steps 1–4, not a Gen6 rollout. Sibling projects are outside that approval. Offline work covered the isolated candidate/provider contract, pure adapter construction, covered consumer seams and disposable-store provenance checks. The candidate is partial: no transport/config credential loader, no full vnstock removal, and unmatched features remain HOLD. Do not install Gen6 simply to remove it later.

Steps 5–7 remain held: rights/custody and explicitly authorized bounded live sample → lawful saved/new comparison and accepted-capability cutover → complete removal only after every operational dependency has an authorized equivalent or explicit retained-data/unavailable disposition. Resolve `Date` versus `X-Aux-Date`, units, basis, coverage and session finality before a live client; source keys alone do not resolve these. A Gen6 alternative requires renewed approval, v5 compatibility, centralized user-selected source configuration, route-by-route comparisons and explicit unsupported-feature decisions. Do not suppress `SchemaChangeWarning`, invent discontinued features or modify the external AGENTS file.

The user reports that old live validation ended on 2026-11-10; whether a usable saved baseline exists and which contracts it covers is unverified. Without a comparable saved baseline, a direct old-versus-new live comparison is not available. Label comparisons and uncovered contracts accordingly; do not manufacture a baseline.

Retain the separate readiness gates until new actual evidence satisfies them: [#168](https://github.com/Kohnnn/vnibb/issues/168) licensed source permission and coverage, [#171](https://github.com/Kohnnn/vnibb/issues/171) bounded authorized production recovery, [#172](https://github.com/Kohnnn/vnibb/issues/172) an authorized sustainable daily owner, and [#173](https://github.com/Kohnnn/vnibb/issues/173) consumer verification and strict watch across recovery and the next session. Check the current issue state and evidence rather than assuming these are still open or completed. Credential rotation/readiness gates also remain unless current evidence closes them. **Source rights are separate from installer or account entitlement**; neither a working installation nor possession of credentials authorizes data acquisition. This documentation handoff does not authorize PostgreSQL/MongoDB recovery, acquisition, production writes, deployment, or release. See [the Oracle runbook](oracle_runbook.md) and the canonical ledger for operational prerequisites.

## Remaining VniBB workstreams

The issue bodies and [#241 ledger](../project-work-backlog.md) own detailed acceptance, dependencies, evidence and assigned roles. The links below route work; they do not create another checklist or assume all open issues require new code.

| Workstream | Next owner and unresolved boundary |
| --- | --- |
| Credential safety and source rights | Security/operator privately contain the recorded exposure and establish rotation/custody under [#231](https://github.com/Kohnnn/vnibb/issues/231); the source owner obtains written per-source, per-use rights and cohort coverage under [#232](https://github.com/Kohnnn/vnibb/issues/232) and [#168](https://github.com/Kohnnn/vnibb/issues/168). Do not place secrets, account state or raw data in chat, issues or evidence. |
| Direct provider and version decisions | Provider engineer reconciles [#191](https://github.com/Kohnnn/vnibb/issues/191), offline [#233](https://github.com/Kohnnn/vnibb/issues/233) and comparison/cutover [#234](https://github.com/Kohnnn/vnibb/issues/234) against the selected candidate, source semantics and rights; unmatched financial statements, ratios and other capabilities stay unavailable. The held #239 is a separate safety/history disposition, not a substitute. |
| Market, finance and operations | Data owner/operator reconcile [#111](https://github.com/Kohnnn/vnibb/issues/111), [#129](https://github.com/Kohnnn/vnibb/issues/129), stored/admitted financial lineage, backup/custody and readiness [#171](https://github.com/Kohnnn/vnibb/issues/171)–[#173](https://github.com/Kohnnn/vnibb/issues/173). A fresh independent-custody paired backup and off-source restore, rights and exact authorization precede bounded recovery; one authorized daily producer and a following completed session precede strict consumer/watch acceptance. Review operations and historical cohost/backup items in ledger sections 3 and 6 without changing hosts or stores implicitly. |
| UI, QA, brand and release | QA/frontend own [#194](https://github.com/Kohnnn/vnibb/issues/194), [#200](https://github.com/Kohnnn/vnibb/issues/200), [#202](https://github.com/Kohnnn/vnibb/issues/202) and [#236](https://github.com/Kohnnn/vnibb/issues/236). Finish exact-release populated/interactive width, theme and accessibility evidence, rollback and actual served-artifact identity. The real TradingView iframe forward/reverse keyboard check was **not run** in the 2026-11-16 residual attempt because controlled allowlisted egress was unavailable; synthetic frames are not a substitute. |
| Specific data/consumer residuals | [#245](https://github.com/Kohnnn/vnibb/issues/245), [#249](https://github.com/Kohnnn/vnibb/issues/249), [#250](https://github.com/Kohnnn/vnibb/issues/250), [#251](https://github.com/Kohnnn/vnibb/issues/251) and [#262](https://github.com/Kohnnn/vnibb/issues/262) remain open for their issue-specific real lineage, serving or acceptance boundaries despite merged fixes and historical synthetic evidence. In particular #263 merged the #249 code; it did not reconstruct missing original data. |
| Matrix, agent and identity | Product/security/QA reconcile [#24](https://github.com/Kohnnn/vnibb/issues/24), [#35](https://github.com/Kohnnn/vnibb/issues/35), [#42](https://github.com/Kohnnn/vnibb/issues/42), [#81](https://github.com/Kohnnn/vnibb/issues/81), [#93](https://github.com/Kohnnn/vnibb/issues/93) and [#96](https://github.com/Kohnnn/vnibb/issues/96): real client and role-bound identity, source/export rights, explicit human Send, and bank/regulatory mapping remain distinct. Fixtures or a local SDK do not prove those gates. |
| Product and workflow tails | Product owners disposition the Sheets, sharing/PWA, FX, chart/sector and AI/export roadmap tails in ledger section 9 against current code and permissions; preserve deliberate unavailable/deferred outcomes and prior completed work. |

At the snapshot, the latest [#129 watch comment](https://github.com/Kohnnn/vnibb/issues/129) reported degraded at 2026-11-17 00:56:52 UTC, revision `db1926523c15c6e25b5673b0294e571574163ef5`, [run 43991699284](https://github.com/Kohnnn/vnibb/actions/runs/43991699284). This is a dated GitHub report, not a new live probe, a claim about every service, or evidence that the source/recovery gates are satisfied. Main's automatic Vercel Git deployment was deliberately disabled in the accepted code checkpoint; the release owner must verify current controls and explicit release/rollback authority before changing them.

## Document disposition and next-agent start

- Keep the ledger and dated evidence as history; older row titles, draft/issue counts, historical local paths and earlier "current" snapshots are not live status. Resolve conflicting dates against later sourced checkpoints and GitHub, not by deleting history. `docs/archive/` and older execution plans remain references to reconcile, not separate authorization or automatically current plans.
- Read the [session coverage index](SESSION_HISTORY_INDEX.md) for recovered-summary coverage and limitations; the available recaps do not establish that every original chat turn survived. Raw chats, old artifacts, unrelated dirty worktrees and external `AGENTS.md` files are preserved, not published or cleaned up by this handoff.
- Use the [single cross-repository prompt](AI_CONTINUATION_PROMPT.md). For VniBB, recheck the existing issue and PR, inspect checkout ownership and dirty state, select an independent authorized slice, and work against its current acceptance criteria. Preserve the encoded candidate and compare intervening `main` changes before any isolated recovery. Record the exact revision, command, actual exit and evidence limits; distinguish source code, build, database, CI and deployed identities.
- User/operator handoffs are explicit: source owner supplies applicable rights and coverage; credential owner privately contains/rotates and updates authorized consumers; operations owner supplies backup/restore and recovery authority; QA/security provides controlled iframe access and exact-artifact evidence; identity/client owners supply real users/roles and the human performs any authorized Send. None is completed merely by documenting a blocker.

Read-only, bounded metadata checks for a future authorized continuation (these do not access data providers; do not print secrets or read account stores):

```sh
timeout 10s git rev-parse --show-toplevel HEAD
timeout 10s git status --short --branch --untracked-files=no
timeout 10s git diff-files --name-only
timeout 10s git ls-files --others --exclude-standard -- docs/
timeout 30s gh issue list --repo Kohnnn/vnibb --state open --limit 100
timeout 30s gh pr list --repo Kohnnn/vnibb --state open --limit 100
timeout 30s gh pr view 265 --repo Kohnnn/vnibb --json state,isDraft,headRefOid,baseRefName,url
timeout 30s gh pr view 263 --repo Kohnnn/vnibb --json state,mergedAt,mergeCommit,url
timeout 30s gh issue view 241 --repo Kohnnn/vnibb
```

These commands have not been run as a new acceptance suite. A timeout leaves the corresponding state unknown; inspect only the relevant scope and never assume an untracked-free checkout from `--untracked-files=no`. Source reconstruction and hash checks, if subsequently authorized, are documented in the [portable evidence README](evidence/continuation-20261116/README.md); do not apply that delta to a dirty checkout or current main.
