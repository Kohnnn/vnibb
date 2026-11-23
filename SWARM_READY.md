# Swarm-ready handoff

Repository: `Kohnnn/vnibb`. Contract: `swarm-ready/v1`. Source inspection: 2026-11-23.
Default branch: `main`. Inspected base: [df6a6d6f35c1](https://github.com/Kohnnn/vnibb/commit/df6a6d6f35c1e5bcee60d67b79c81c351530d425).

**Status: documented; runtime qualification is unverified.** This file defines an agent workflow. It does not install a shell command, enroll the repository in a scheduler, certify test success, or activate VMs. Follow the current user task and existing repository instructions; retain prior authorization within its actual scope.

## Invoke

Give the working agent this prompt:

```text
swarm ready: <one measurable repository objective>
Read SWARM_READY.md, the README's agent section, and any applicable local
AGENTS.md. Continue the current owned work or ready issue. Establish the
baseline, acceptance check and bounded handoff. Report what is documented,
implemented, tested and observed separately.
```

If a `swarm-ready` skill is installed, load it. Otherwise execute the documented workflow directly. Treat the phrase as an agent instruction unless the installed CLI explicitly advertises it. Inspect help/version before using optional command adapters.

## Repository starting point

Start at the [README's agent section](README.md#for-ai-coding-agents) and [docs hub](docs/README.md). The [continuation handoff](docs/VNIBB_VNSTOCK_CONTINUATION_HANDOFF.md) and [#241](https://github.com/Kohnnn/vnibb/issues/241) describe the integration route. For data-quality work, read the latest comments and linked PRs in [#274](https://github.com/Kohnnn/vnibb/issues/274) (coverage), [#111](https://github.com/Kohnnn/vnibb/issues/111) (consumer QA), and [#270](https://github.com/Kohnnn/vnibb/issues/270) (widget provenance).

For a data-quality task, reproduce one open defect with a deterministic fixture or independently verify its incumbent fix. Trace the fixture or provider through normalization, storage, API/MCP, and derived output where applicable. Preserve fiscal period and basis, units/scales, provenance, and observation versus fetch time. Keep actual zero distinct from missing, and report partial, stale, unsupported, and failed states without inventing coverage. A fixture or sampled ticker replay does not establish database-wide or serving acceptance.

Do not copy README example test names such as 'bug description' or 'test_name' into executable evidence. Select existing tests after inspecting the touched component.

The base above is an inspection snapshot, not a permanent working branch. Refresh the actual target branch, current issues, incumbent worker and applicable nested instructions before editing. Preserve unrelated changes and upstream/fork boundaries.

## Execution logic

1. **Recover context.** Read the current issue, work order and last evidence-backed handoff. Keep useful work and the active worker. Record source commit, unresolved criteria and the next action; avoid repeating completed investigation.
2. **Define success.** State one outcome, baseline, target, changed paths, verification command and expected result. Keep acceptance criteria and reference data fixed unless the user changes the requirement.
3. **Bound the attempt.** Reuse the existing owner/task/attempt identities, action scope, resource limits, time/cost budget and retry allowance. Do not demand a new user-written permission receipt for already authorized work. If a real capability or grant is missing, name the exact blocked action and continue independent work.
4. **Partition only useful work.** Use one writer per branch/worktree and non-overlapping change scope. Reuse the existing task ledger and dependency graph. Reserve verification capacity before adding workers; avoid recursive worker growth and duplicate coordinators.
5. **Implement and measure.** Make the smallest coherent change. Use differential checks when a trusted reference exists, and deterministic failure simulation when it materially improves reproduction. Record the seed/configuration and counterexamples. Do not weaken tests, rewrite baselines or hide pre-existing failures to claim success.
6. **Verify and integrate.** Verify the exact returned commit independently in a clean environment. Recheck the final integrated revision when changes interact. Follow existing review, merge and deployment rules; a green worker report alone cannot override them. Use the narrowest checks that resolve a concrete risk.
7. **Checkpoint and finish.** Save candidate SHA, evidence, measured outcome, remaining blockers and a precise next action before context/lease expiry. Reconcile lost or duplicate completions before retrying. Release only the run's owned resources after preserving evidence. Stop when the requested outcome is met or a concrete blocker prevents the next required action.

### Source-only integration

Use the existing [#241 integration route](https://github.com/Kohnnn/vnibb/issues/241#issuecomment-6947010920) with its incumbent owner. Refresh the exact heads and effective provider/hook settings for `main` and `codex/project-integration-20261110` before publication. The named disables in [`apps/web/vercel.json`](apps/web/vercel.json) and `turbo-ignore` are not proof of the effective deployment settings or a guarantee for other branches. Keep leaf changes local unless their permitted route is verified. Source integration is not authorization for releases, provider calls, acquisition/backfill, production writes, or scheduler changes.

## Verification starting point

| Declared command | Working directory | Source and limit |
| --- | --- | --- |
| `pnpm --filter frontend exec tsc --noEmit` | `.` | README.md; frontend typecheck |
| `pnpm --filter frontend lint` | `.` | README.md; frontend lint |
| `pnpm --filter frontend test` | `.` | README.md; frontend test entry point; choose actual relevant tests |
| `python -m ruff check apps/api` | `.` | README.md; API lint |
| `python -m pytest apps/api/tests -v` | `.` | README.md; API test entry point; inspect fixture/service requirements |
| `pnpm run build` | `.` | package.json; workspace build, only when relevant |

These commands were read from the pinned source, not executed for this documentation change. A declared script is not a passing baseline. Confirm the current environment and hooks, select the checks relevant to the scoped change, and record the exact candidate SHA and evidence. For a documentation-only task, review factual anchors, links and whitespace; do not run unrelated application builds.

## Required handoff result

Return a concise record with `repository`, `objective`, `issue_or_work_order`, `base_sha`, `candidate_sha`, `owner`, `task_id`, `attempt_id`, `worker/session`, `branch/worktree`, `changed_paths`, `environment`, `resource/budget limits`, `acceptance`, `commands_and_results`, `evidence_refs`, `known_failures`, `blocker_owner`, `next_action`, and `cleanup_status`. Use null/unknown when a field is unavailable; never manufacture evidence or authority.

Keep documentation readiness, command availability, source tests, live environment qualification and accepted outcome as separate states. Count verified outcomes, regressions, elapsed time, cost and human interventions. Commits, lines, tokens and worker count describe activity only.
