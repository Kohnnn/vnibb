# Backup + Restore Drill

Disaster-recovery evidence and the repeatable drill for the VNIBB durable stores:
hosted PostgreSQL (`postgres`) and the n6v MongoDB `vnibb-market` corpus.

The drill proves a backup set is actually restorable, not just present on disk. It
performs **no writes to any source system** and exposes **no host ports** — every
restore target is a throwaway Docker container reachable only via `docker exec`.

## Artifacts

Each backup set is identified by a UTC stamp (`<id>`, e.g. `20260721T181749Z`) and
lives under `../backups` (sibling of the app repo, on a host separate from the n6v
MongoDB host and the hosted PostgreSQL source):

- `supabase-<id>.dump` — PostgreSQL custom archive (`pg_dump -Fc`, zstd level 9).
- `vnibb-market-<id>.archive.gz` — MongoDB `mongodump --archive --gzip`.
- `BACKUP_VERIFICATION_<id>.json` — manifest: source sizes/versions, artifact
  SHA256, and the verification results the drill reproduces.

## Running the drill

```bash
# newest backup set
./scripts/oracle/verify-backup.sh

# a specific set
./scripts/oracle/verify-backup.sh 20260922T133456Z
```

The script, for each engine:

1. Rechecks the artifact SHA256 against the run manifest (aborts on mismatch).
2. Starts a scratch database from the manifest-pinned image.
3. Restores the artifact, failing on any restore error.
4. Asserts public-table parity against the live database, then drops the scratch
   database.

Exit code is non-zero if any restore command or parity check fails.

This replaces `scripts/restore-drill.ps1`, which was PowerShell-only and — as
far as the repository records go — had never been executed against this
Postgres 17 stack. A drill that only runs on one operator's platform is not a
drill. The gotchas below are the ones it discovered and are retained here
because they are still true.

## Engine-specific gotchas

- **PostgreSQL must use the Supabase image** (`supabase/postgres:17.6.1.136`), not
  vanilla `postgres:17`. The dump references Supabase-only roles (`supabase_admin`,
  `supabase_vault`) and extensions (`http`, `pg_stat_statements`, `pgcrypto`,
  `supabase_vault`, `uuid-ossp`, `plpgsql`); a vanilla image errors on them.
- **Restore into a fresh `template0` database**, not the image's preseeded
  `postgres`. Restoring into `postgres` requires `--clean --if-exists` and then
  emits unavoidable errors (`cannot drop schema graphql_public`, missing
  `supabase_functions_admin` / `supabase_realtime_admin` roles) that force the
  drill to tolerate a non-zero `pg_restore` exit — which would also hide a genuinely
  partial restore. The drill therefore runs
  `createdb -T template0 vnibb_restore` and
  `pg_restore --no-owner --no-privileges`, and treats any error as a failure.
- Restore and admin queries run as `supabase_admin`, not `postgres`.
- The Supabase image is a ~45s two-stage boot, so readiness is polled up to 120s.
- **Copy artifacts in as a file, not through a pipeline.** Feeding a binary dump
  to a shell that stringifies stdin corrupts the archive; PowerShell's
  `Get-Content |` was the original offender. `verify-backup.sh` copies the file
  into the container and restores from the path.
- MongoDB restores with `--drop --stopOnError` so a re-run is idempotent inside the
  container and a truncated archive fails loudly (a partial download once restored
  202390 documents before erroring, which `--stopOnError` surfaces immediately).

## Last verified drill

Backup set `20260922T133456Z`, run via `scripts/oracle/verify-backup.sh`:

| Engine     | Image                          | Parity            | Result |
| ---------- | ------------------------------ | ----------------- | ------ |
| PostgreSQL | `supabase/postgres:17.6.1.136` | 39/39 tables      | pass   |
| MongoDB    | `mongo:7`                      | 16/16 collections | pass   |

Checksum recheck: pass. `stocks` spot-check: 1753 rows.

Earlier verified set `20260729T190249Z` (via the retired PowerShell script):
37/37 tables, 16/16 collections, checksum pass.

## Where the artifacts actually go

Superceded note: the sets under `../backups` are still on the same host, but they
are no longer the only copy. `scripts/oracle/vnibb-backup.sh` runs daily at 03:30
host time, keeps the newest 7 sets, and the sets are pulled to an always-on
workstation over Tailscale with sha256 parity — so the same-disk failure mode is
covered. Restic is **not** the mechanism: OCI Object Storage authorization is
denied in this tenancy, and instance-principal access only reaches the namespace,
not bucket operations. The Tailscale pull is the off-box leg.

Two failure modes remain, stated plainly:

- Off-box copies are integrity-verified but have not been restored end-to-end
  onto a fresh host. The drill restores into a scratch database on the same host.
- Nothing encrypts the artifacts at rest.
