# Open decisions blocking a data-trust gate: rate limiter and off-box target

**Date:** 2026-09-26
**Scope:** issues [#23](https://github.com/Kohnnn/vnibb/issues/23) and [#31](https://github.com/Kohnnn/vnibb/issues/31)
**Status:** both need an operator decision. Neither is blocked by code.

Both items are the last two open sub-issues of [#24](https://github.com/Kohnnn/vnibb/issues/24).
The seven engineering issues under that map were verified fixed and closed; these two
cannot be closed by a commit, so this document states exactly what a human must do.

---

## 1. Rate limiter (#23)

### Current state — verified at HEAD

| Location | Value |
| -------- | ----- |
| `apps/api/vnibb/core/config.py:158` | `rate_limit_mode: str = "off"` (code default) |
| `apps/api/.env.example:1` | `RATE_LIMIT_MODE=off` |
| `deployment/env.oracle.example:34` | `RATE_LIMIT_MODE=shadow` |
| `deployment/env.oracle` (the real deployed file) | **not in the repository** |
| `docker-compose.oracle.yml` | API reads `env_file: ./deployment/env.oracle` (`required: false`) |

The middleware is complete and has three modes, validated at `config.py:303-310`
(only `off`, `shadow`, `enforce` are accepted):

- **`off`** — `dispatch` returns before any Redis work (`rate_limit.py:60-61`). Not even shadow.
- **`shadow`** — consumes the bucket, sets `X-RateLimit-Status: shadow` or
  `shadow-exceeded`, logs a warning on exceed, and **never returns 429**
  (`rate_limit.py:79-86`).
- **`enforce`** — returns HTTP 429 with `Retry-After` on exceed (`rate_limit.py:88-101`).

A Redis failure always **fails open** — the request is allowed and the response
carries `X-RateLimit-Status: unavailable` (`rate_limit.py:73-77`). So switching this
on cannot take the API down.

### Why it is still off

The real `deployment/env.oracle` is deliberately absent from the repo — it holds
production credentials — so its current value cannot be read from here. The example
file says `shadow`, but that is an example, not the deployed state. `#23` asserts the
deployed value is still `off`, and nothing in the tree contradicts that.

### The decision

Pick a mode and set one variable on the node. Recommended sequence: **`shadow` first.**

```console
# on the production node, after confirming the current value
grep -n RATE_LIMIT_MODE /srv/vnibb/deployment/env.oracle      # expect: off, or absent
# set it to shadow, restart the api service, then observe
```

Evidence to collect before moving to `enforce`:

- `X-RateLimit-Status` distribution across real traffic. If `shadow-exceeded` appears at
  the configured window/limits, the limits are wrong for current usage and `enforce`
  would start rejecting legitimate clients.
- `X-RateLimit-Policy` values, to confirm the bucket resolution
  (`_resolve_bucket(request.url.path)`) maps endpoints to the buckets you intend.
- Whether Redis is actually reachable in production. `REDIS_URL` is empty in the CI
  env; if the deployed container also has no Redis, every request will fail open and
  report `unavailable`, which makes `enforce` a no-op rather than a risk.

**Risk of going straight to `enforce`:** the per-bucket limits were never observed
against live traffic, so the first evidence of a mis-set threshold would be customer
429s. `shadow` produces the same information with no user impact.

**What would close #23:** `RATE_LIMIT_MODE=enforce` deployed, with a recorded period of
shadow data showing the thresholds are not tripping legitimate traffic.

---

## 2. Off-box backup target (#31)

### Current state — the code is already good

The recovery utility and a real drill exist. The gap is that no off-box *target* is
configured, so the newest data is still single-disk.

| Artifact | Status |
| -------- | ------ |
| `scripts/oracle/vnibb-backup.sh` | Produces Postgres + Mongo dumps with a SHA-256/size manifest |
| `scripts/oracle/restore-offbox.py` | Restores both engines into `--network none` throwaway containers, requires `--confirm-isolated`, verifies the paired manifest, asserts row counts, prints `RECOVERY OK` only after cleanup |
| `docs/BACKUP_RESTORE_DRILL.md` | Recorded drill 2026-09-23: 37 tables / 1,742 stocks / 1,745,922 prices / 7,964,485 Mongo docs, RTO 141.1s |
| `docs/research/OFF_BOX_BACKUP_TARGET_2026-09-22.md` | Full option analysis with measured capacities and costs |

### What the research already determined

Measured on the node, not estimated:

- **Data to protect:** Postgres 17 GB → **1.158 GiB** compressed; Mongo 4.40 GiB → **375 MiB**. Combined **1.524 GiB** per full dump.
- **Growth:** `prediction_markets` at ~386,000 rows/day ≈ **13.9 MiB/day** compressed.
- **restic does not help compression** (0.06% saving — the dumps are already zstd-9), **but dedup does**: on an unchanged append-only database, restic stored **452.6 MiB of a 1.243 GiB dump (36%)**.
- **7-snapshot retention projection:** ≈12.9 GB pessimistic / ≈7.9 GB with measured dedup today; crosses 10 GB within weeks, ≈34 GB / ≈19.5 GB at +90 days.
- **OCI Always Free gives 20 GB combined**, so a two-engine 7-snapshot repository fits — but only inside the real 20 GB allowance, not the 10 GB the old deployment doc quotes.

### The decision: three viable targets

| # | Option | Setup on the node | Honest trade-off |
| - | ------ | ----------------- | ---------------- |
| 1 | **OCI Object Storage + restic (S3-compat)** | Needs a dynamic group + policy, **and** a Customer Secret Key placed on the node | Native, 20 GB free covers it. Requires a long-lived static credential on the box — the one thing the current design avoids |
| 2 | **restic → workstation over Tailscale** | Works today, $0 | Already proven end-to-end, but the workstation becomes the off-box leg. An unencrypted plaintext copy plus the `.age` key live on that same machine, so losing it loses both |
| 3 | **OCI Object Storage via rclone** | Dynamic group + policy only (instance principal works for the native API) | No static credential, but restic needs rclone as its transport |

**Blocker common to the OCI options:** the instance principal authenticates
successfully (`oci os ns get --auth instance_principal` returns the namespace) but is
**not authorized** — no dynamic group grants Object Storage rights and no bucket
exists. This is a tenancy-admin Console action, not something the node can do.

### Minimum work to close #31

1. As tenancy admin, create dynamic group `vnibb-instances` matching
   `instance.id = '<the production instance ocid>'` and grant
   `manage objects in tenancy where target.bucket.name='vnibb-backup'` (plus
   `manage buckets` if restic should create it).
2. Create the bucket in the **home region** (`ap-singapore-1`) — Always Free resources
   outside the home region are billed.
3. Decide the credential question: Customer Secret Key (option 1) or rclone transport
   (option 3). Option 2 avoids it entirely but keeps the workstation in the path.
4. Run one backup to the new target, then **one `restore-offbox.py` against it** and
   record the result in `docs/BACKUP_RESTORE_DRILL.md`, replacing the historical
   2026-07-29 pair as the evidence with a current one.
5. Address key custody: today the unencrypted copy and its `.age` key can be lost
   together. The drill doc already flags this as an open risk.

**What would close #31:** a configured off-box target, a restore drill performed
against *current* data (not the 2026-07-29 pair), and independent key custody recorded.

---

## Why neither is in this change set

Both require production credentials or tenancy-admin access that this environment does
not have. Making a code change to paper over them would be worse than leaving them
open: the repo's own `spec-sweep-next-work.md` recorded the same conclusion, and
`#23` was explicitly parked as "the one blocked item".
