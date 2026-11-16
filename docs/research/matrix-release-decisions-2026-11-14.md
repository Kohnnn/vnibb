# Matrix release gates and retained decisions — 2026-11-14

Read-later dispositions for [#35](https://github.com/Kohnnn/vnibb/issues/35),
[#42](https://github.com/Kohnnn/vnibb/issues/42), [#93](https://github.com/Kohnnn/vnibb/issues/93),
[#96](https://github.com/Kohnnn/vnibb/issues/96) and [#81](https://github.com/Kohnnn/vnibb/issues/81).
This record restates decisions already taken in those tickets. It creates no new policy, grants no
source rights, operator identity or admin access, and authorizes no model send. No provider,
production or credential action was performed to write it.

## #42 / #35 — stage boundaries unchanged

| Stage | Proof it carries | Entry condition | State |
|---|---|---|---|
| **0 — Fixture / local preview** | Contract shape and rendering only, always labelled synthetic. Never evidence. | none | implemented |
| **1 — First real structured-evidence path** | One continuous scenario on the non-financial quality playbook: latest **common fiscal year**, anchor plus an explicit **2–10** company shortlist, exact-or-explicitly-unavailable cells, no execution from view/copy, **owner-only** access. | #90, #91, #92, #94 | implemented; accepted at its original revision |
| **2 — Financial-services playbooks** | Bank / insurer / securities playbooks in the same release line. | #51, #53, #55 decided (accounting-only, explicitly qualified) | implemented; safe-unavailable behaviour only |
| **3 — Full dual-client release** | The external MCP leg resolves the same frozen run under delegated per-user authority. | a **named** external conversational client is selected and tested | **open** |

A stage-0 fixture result is never reported as stage 1+. Stage 3 stays gated on a named real
client: an official SDK `ClientSession` or Inspector run establishes protocol interoperability at
its tested version, not conversational-client parity.

## #93 — frozen-reference handoff

Already accepted and unchanged by this note:

- Handoff uses distinct typed `matrix_run_ref` plus bounded `candidate_ids`; a reference is never
  pasted into `message` or inferred from capitalised text.
- Output is complete-or-reject: 1–120 unique result IDs, a packet over **524,288 UTF-8 JSON bytes**
  rejected with **413**. No truncation or pagination of observations.
- Inaccessible references — revoked, unknown, or owned by someone else — are refused whole with no
  partial observations. Eligibility is decided by ownership plus the revocation tombstone.
- Owner revocation is always available and is rechecked after the snapshot row lock is acquired, so
  a revoke that commits while another request waits is observed by that request. That ordering is
  covered by a native PostgreSQL two-session contract test.
- Frozen runs are retained; **no age-based expiry policy has been selected.** If a time-based
  lifecycle is wanted, it needs its own explicit contract with retention, revocation and lineage
  semantics decided first.

Still **unexercised by design**: positive explicit human-initiated Send and a rights-authorized
transfer of exact frozen context. Source metadata is not a permission grant, so this remains open
without a model or provider call.

## #96 — bank regulatory dimension: deferred, non-blocking

Deferred out of #51; it does not block stage 2. The eight bank regulatory metrics (`car`, `cet1`,
`tier1`, `rwa`, `reported_npl`, `npl_coverage`, `regulatory_ldr`, `regulatory_liquidity`) render as
typed `unavailable` cells carrying circular/version candidates with `method`, `perimeter`,
`observation_date` and `reported_or_derived` null. No accounting proxy is admitted: equity/assets is
not CAR, reserves/gross loans is not NPL coverage, accounting loans/deposits is not regulatory LDR.

Issuer research is retained in [`matrix-bank-evidence.md`](./matrix-bank-evidence.md) as
**issuer-reported research observations, not admitted VNIBB ratios**. Remaining gap: operative
circular/amendment chain, bank-specific adoption, method, regulatory consolidation perimeter,
observation date, coverage input linkage and positive reuse rights. No cell is filled by proxy.

## #81 — interactive admin: locked, negative guards retained

Interactive administration stays fail-closed on an empty server-owned `ADMIN_USER_IDS`. A
browser-local identity, client-controlled `user_metadata` role, a stale
`vnibb_admin_layout_key_validated` flag, or the former platform-wide key cannot authorize it; the
legacy storage keys are erased on load. Server automation keeps its separately scoped `X-Admin-Key`
guard, which rejects browser origins and denies when unconfigured.

The rotation is **historical**: the formerly browser-exposed platform key and the scoped secrets
were rotated and the old values verified denied in their own scope. This record does not request,
create or invent an operator, and does not re-open live unlock/draft/publish acceptance. A deployed
image rollback must never restore the exposed credentials.

## Preserved gates

Licensed source permission and coverage (#168/#232), service rights, fresh recovery prerequisites
(#171), one sustainable authorized daily owner (#172), and next-session cross-store verification
(#173/#129) all remain open. Current vnstock SDK pin stays 5.2.1.
