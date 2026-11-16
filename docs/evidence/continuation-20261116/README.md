# VNIBB continuation evidence

Documentation transfer only. [Continuation handoff](../../VNIBB_VNSTOCK_CONTINUATION_HANDOFF.md) owns the next-agent sequence; the existing [continuing-work ledger](../../CONTINUING_WORK_EVIDENCE_2026-11-10.md) and GitHub issues remain authoritative for acceptance.

## Recover the local-only DNSE candidate

The source branch `codex/233-dnse-offline-20261116` was not present on the remote at transfer time. The portable delta preserves all 13 changed files in local commit `bc2c8ff20dfe2f96e5742311a834a2e31e4f467c`, relative to published parent `7d71fb4ab3491da008b1e71599f032b75301ec10`. It is source preservation, not a production adapter release. The decoded patch has mixed line endings; retain the base64 encoding in transit.

From an existing clone, recover only into a new, issue-bound isolated checkout at that parent. Set `EVIDENCE` to the absolute path of this directory before changing directories:

```sh
(
  set -e
  patch=$(mktemp)
  trap 'rm -f "$patch"' 0
  base64 --decode "$EVIDENCE/dnse-offline-bc2c8ff2.patch.base64" > "$patch"
  printf '%s  %s\n' 'ab9444a12396b02309e071c402a56a28661487e3adb8b67a199acb84ef73ed48' "$patch" | sha256sum --check
  # In the isolated checkout at 7d71fb4ab3491da008b1e71599f032b75301ec10:
  git apply --check "$patch"
  git apply "$patch"
)
```

Do not apply the delta over the dirty original checkout or current main without reviewing intervening changes. A new commit will have a new identity; do not claim the original commit was recreated. `dnse-offline-receipt.json` records the decoded digest and complete candidate-file hashes.

The transfer check decoded the artifact, used a disposable Git index at the recorded parent, applied the patch, and compared trees. Actual exit 0; reconstructed and original candidate trees both `5b998b80e90b39e6755af10a507a973bf72a738e`. The working tree and user's index were untouched. The first text-export attempt failed applicability because the shell helper normalized embedded CRLF; that copy was removed and replaced with this byte-exact encoding. No application defect or new application test result follows from this transfer check.

## Historical evidence ceiling

`dnse-offline-receipt.json` is a sanitized summary of the previously recorded local candidate receipt, not the original raw logs. It retains 287 unit/compatibility passes, 65 disposable PostgreSQL/MongoDB/Redis passes, the full backend run's 32 failures, and the separate successful 43-test MCP harness correction. The full run is not relabelled as green. Original raw command scripts/logs remain local under the ignored `vnstock-migration/` workspace; they are not portable evidence in this PR.

The isolated candidate has pure transforms/signing/request construction and provenance guards, no transport or credential loader. Unknown monetary/volume units, adjustment basis, session finality, the `Date`/`X-Aux-Date` discrepancy, source permission and full feature parity remain unresolved. The older held PR #239 is not this candidate and must not be merged as a shortcut.

## Prior migration review, not a Generation 6 deployment

The subsequent approved direction was a direct-DNSE exit for **VniBB only**, offline steps 1–4; Gen6 remains an unapproved alternative. No Gen6 installation or `vnstock status` result exists in this review. No account/source keys or OTPs were read, and no entitlement is inferred.

The previous bounded metadata probe found local API Python **3.11.16 / vnstock 5.2.1**, plus `vnai 2.6.2` and `vnstock_ezchart 1.0.2`. The separate home venv had Python **3.12.3 / vnstock 5.2.1**, `vnstock_news 3.3.0`, `vnstock_pipeline 3.4.0`, `vnstock_quant 0.5.0`, `vnstock-mcp 0.5.0` and `vnstock_chart 1.0.0`. System Python **3.12.3** had no vnstock metadata. No Gen6 distribution, Conda environment or Jupyter kernel was found in the inspected standard locations; custom paths remain outside scope. Metadata and colocated configuration identify a likely local runtime, not the running production interpreter. Nine interpreter probes exited 0 using `-I -S -B` without SDK imports or startup hooks.

The tracked inventory parsed 505 Python files without parse errors. Supplemental tracing found 136 candidate nodes / 42 patterns / 38 files, not independently exercised routes. No operational `vnstock_pipeline` package use was established, so no pipeline skill/add-on was added. No installation/bootstrap operation occurred.

No complete pre-shutdown per-call baseline was verified. Retained downstream database rows cannot reconstruct original DataFrame dtypes, attributes, timezones or ordering. Legacy live retrieval is not an available comparison path after the reported November 10 shutdown. Price units, definitions, null positions, keys, coverage, order, timezones and values remain unverified until lawful saved inputs and separately authorized new outputs exist. No source warning suppression or replacement calculator is permitted to hide missing functionality.

Financial statements, ratios, news, officers, subsidiaries and other unmatched features remain HOLD; DNSE market-data documentation is not full application equivalence. A Generation 6 alternative would require v5 compatibility, one explicitly selected source, route-by-route contract comparison and explicit unsupported-feature decisions before promotion. The external parent `AGENTS.md` remains unchanged; its proposed G9 preview was never applied.

Original official procedure: [START HERE](https://vnstocks.com/api/skills/migration-assistant/content), [contract check](https://vnstocks.com/api/skills/migration-assistant/reference/contract-check.md), [source registration](https://vnstocks.com/docs/vnstock-oapi/gioi-thieu), [G9](https://vnstocks.com/files/vibe-onboarding.md). Selected direct-source registration: [DNSE guide](https://developers.dnse.com.vn/docs/guide/intro/register_guide/). Operators enter keys/OTP manually outside chat; the `command` file and account stores remain unread.

This transfer grants no live provider calls, source cutover, database recovery/writes, scheduler enablement, deployment, legal acceptance or closure of #168/#171/#172/#173/#231/#232/#233/#234. Existing saved-data reads are the lazier alternative until those prerequisites are met.
