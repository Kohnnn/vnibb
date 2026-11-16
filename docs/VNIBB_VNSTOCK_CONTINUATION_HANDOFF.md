# VNIBB / vnstock continuation handoff

Snapshot: 2026-11-16. This is a transfer guide, not a new backlog or a release approval. Start with the canonical [cross-session ledger](../project-work-backlog.md), its linked evidence, and current GitHub issues and PRs. Historical plans and retained reports are evidence of their own dates, not proof of the present production state.

## Snapshot and ownership

- Active app repository: `Kohnnn/vnibb`. The original checkout remains on `codex/195-e2e-production-fix`, HEAD `64ee0e70bb539765e760a1914e48a2d2eb4b516b`. Initial modified paths: `apps/api/tests/test_scripts/test_backup_disk_preflight_script.py`, `apps/web/src/components/widgets/ListingBrowserWidget.tsx`, `scripts/oracle/vnibb-backup.sh`. Initial untracked paths: `apps/web/matrix-readability-test.ts`, `apps/web/matrix-readability.js`, `apps/web/src/app/readability/`, `apps/web/src/components/widgets/MatrixReadabilityFixture.tsx`, `artifacts/`, `project-work-backlog.md`. Preserve them; the untracked ledger there can differ from the tracked canonical copy.
- This handoff belongs to [issue #264](https://github.com/Kohnnn/vnibb/issues/264), branch `codex/264-vnibb-continuation-handoff`, created clean at cached `origin/main` `7d71fb4ab3491da008b1e71599f032b75301ec10`. Before verification, the documentation checkout was fast-forwarded to live main `13de94e526b777135c4472b000576a3f1f4a39e8`; only the handoff/index/evidence files are publication scope. Discover checkout paths through `git worktree list`; machine-local paths are not portable identity.
- [PR #263](https://github.com/Kohnnn/vnibb/pull/263) merged on 2026-11-16 at 06:40:37 UTC into `13de94e526b777135c4472b000576a3f1f4a39e8`, according to the integration owner's live GitHub metadata receipt. A retained note reports 13 CI jobs passed; the run and individual jobs were not independently verified in this handoff and no tests were rerun. No claim of current deployed release follows.
- [PR #239](https://github.com/Kohnnn/vnibb/pull/239), `feat/dnse-daily-import` to `main`, was open in the bounded metadata snapshot. Recheck it and the complete issue list before assigning work.

## DNSE candidate and portability

The local-only branch `codex/233-dnse-offline-20261116` contains clean candidate `bc2c8ff20dfe2f96e5742311a834a2e31e4f467c`, parent `7d71fb4ab3491da008b1e71599f032b75301ec10`. Ordinary status showed no tracked/non-ignored changes; ignored content was not inspected. The same-named remote branch was absent at transfer time. Preserve the original checkout/object; the older draft PR #239 is not this candidate.

The portable [source delta and recovery instructions](evidence/continuation-20261116/README.md) and [source-bound receipt](evidence/continuation-20261116/dnse-offline-receipt.json) are included in this documentation branch. A disposable-index check reconstructed the exact candidate tree with exit 0. The base64 encoding preserves mixed CRLF/LF; decode and verify before use. Preservation is not source promotion or deployment authority; review intervening main changes before any integration.

Historical offline results and their limits are retained in that receipt: 287 unit/compatibility and 65 disposable-store passes; the full backend run had 32 MCP harness failures, followed by a separate 43-test affected-file pass after isolation correction. No clean aggregate, new application run, live-source parity or full frontend/build result is claimed. Raw scripts/logs remain in the original ignored migration workspace and are not portable evidence here.

## Migration and data gates

The external parent `VNIBB/AGENTS.md` still describes vnstock 5.2.1/VCI. It remains unchanged and is not proof of Generation 6 adoption. The [preserved audit summary](evidence/continuation-20261116/README.md#prior-migration-review-not-a-generation-6-deployment) records environment identification, compatibility limits and official references. No Gen6 distribution was found in the bounded audit; no `vnstock status`, entitlement inference, package install or provider call was performed for this transfer. The running production interpreter remains unestablished.

**Current approved direction: direct DNSE for VniBB only**, not a Gen6 rollout. Offline steps 1–4 covered the isolated candidate/provider contract, pure adapter construction, covered consumer seams and disposable-store provenance checks. The candidate is partial: no transport/config credential loader, no full Vnstock removal, and unmatched features remain HOLD. Sibling projects are excluded by the user's choice. Do not install Gen6 simply to remove it later.

Steps 5–7 remain held: rights/custody and explicitly authorized bounded live sample → lawful saved/new comparison and accepted-capability cutover → complete removal only after every operational dependency has an authorized equivalent or explicit retained-data/unavailable disposition. Resolve `Date` versus `X-Aux-Date`, units, basis, coverage and session finality before a live client; source keys alone do not resolve these. A Gen6 alternative requires renewed approval, v5 compatibility, centralized user-selected source configuration, route-by-route comparisons and explicit unsupported-feature decisions. Do not suppress `SchemaChangeWarning`, invent discontinued features or modify the external AGENTS file.

The user reports that old live validation ended on 2026-11-10; whether a usable saved baseline exists and which contracts it covers is unverified. Without a comparable saved baseline, a direct old-versus-new live comparison is not available. Label comparisons and uncovered contracts accordingly; do not manufacture a baseline.

Retain the separate readiness gates until new actual evidence satisfies them: [#168](https://github.com/Kohnnn/vnibb/issues/168) licensed source permission and coverage, [#171](https://github.com/Kohnnn/vnibb/issues/171) bounded authorized production recovery, [#172](https://github.com/Kohnnn/vnibb/issues/172) an authorized sustainable daily owner, and [#173](https://github.com/Kohnnn/vnibb/issues/173) consumer verification and strict watch across recovery and the next session. Check the current issue state and evidence rather than assuming these are still open or completed. Credential rotation/readiness gates also remain unless current evidence closes them. **Source rights are separate from installer or account entitlement**; neither a working installation nor possession of credentials authorizes data acquisition. This documentation handoff does not authorize PostgreSQL/MongoDB recovery, acquisition, production writes, deployment, or release. See [the Oracle runbook](oracle_runbook.md) and the canonical ledger for operational prerequisites.

## Next agent: copy and paste

> Work in `Kohnnn/vnibb`. Read `docs/README.md`, this handoff, `project-work-backlog.md`, `docs/CONTINUING_WORK_EVIDENCE_2026-11-10.md`, the portable evidence README and applicable repository instructions. Confirm current main, issue/branch/worktree ownership and dirty state; preserve all existing work. The approved direction is VniBB-only direct DNSE, offline steps 1–4, not Gen6 installation. Recover the exact local-only candidate from the encoded delta only into an isolated checkout at its recorded parent, verify its hashes, then review intervening main changes before integration. Continue safe offline gaps under #233; keep financials/ratios and unmatched features HOLD. #231/#232/#168 rights/custody and semantic evidence precede any explicitly authorized bounded live request; lawful saved/new comparison and #234 precede cutover; #171 backup/recovery, #172 daily owner and #173 strict-watch/consumer proof remain separate. No credential/account/OTP or `command` inspection, live acquisition, production writes, scheduler enablement or deployment is authorized by this handoff. Report exact candidate, command exits and incomplete scope; local fixtures or CI cannot establish source permission or full parity.

Read-only metadata rechecks (from a repository checkout; they do not access providers):

```sh
git status --short --branch
git worktree list --porcelain
git rev-parse HEAD
git ls-remote --heads origin main codex/233-dnse-offline-20261116
gh issue list --repo Kohnnn/vnibb --state open --limit 200
gh pr list --repo Kohnnn/vnibb --state open --limit 100
gh pr view 263 --repo Kohnnn/vnibb --json state,mergedAt,mergeCommit,statusCheckRollup,url
gh pr view 239 --repo Kohnnn/vnibb --json state,headRefName,baseRefName,statusCheckRollup,url
gh issue view 233 --repo Kohnnn/vnibb
gh issue view 168 --repo Kohnnn/vnibb
gh issue view 171 --repo Kohnnn/vnibb
gh issue view 172 --repo Kohnnn/vnibb
gh issue view 173 --repo Kohnnn/vnibb
```

Discover local worktree paths from `git worktree list`, not assumed paths. These commands establish metadata only; check authoritative CI runs, dates, retained receipts and approval evidence separately before asserting completion.
