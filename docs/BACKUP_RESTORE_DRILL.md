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

```pwsh
# newest backup set in ../backups
pwsh ./scripts/restore-drill.ps1

# a specific set, or skip an engine when only one image is available locally
pwsh ./scripts/restore-drill.ps1 -BackupId 20260721T181749Z
pwsh ./scripts/restore-drill.ps1 -SkipMongo
```

The script, for each engine:

1. Rechecks the artifact SHA256 against the manifest (aborts on mismatch).
2. Starts a throwaway container from the manifest-pinned image.
3. Restores the dump and counts restored objects.
4. Asserts object-count parity against the manifest, then removes the container.

Exit code is non-zero if any parity check fails.

## Engine-specific gotchas

- **PostgreSQL must use the Supabase image** (`supabase/postgres:17.6.1.136`), not
  vanilla `postgres:17`. The dump references Supabase-only roles (`supabase_admin`,
  `supabase_vault`) and extensions (`http`, `pg_stat_statements`, `pgcrypto`,
  `supabase_vault`, `uuid-ossp`, `plpgsql`); a vanilla image errors on them.
- Restore and admin queries run as `supabase_admin`, not `postgres`.
- The Supabase image is a ~45s two-stage boot, so readiness is polled up to 120s.
- MongoDB restores with `--drop` so a re-run is idempotent inside the container.

## Last verified drill

Backup set `20260721T181749Z`:

| Engine     | Image                          | Parity          | Result |
| ---------- | ------------------------------ | --------------- | ------ |
| PostgreSQL | `supabase/postgres:17.6.1.136` | 34/34 tables    | pass   |
| MongoDB    | `mongo:7`                      | 16/16 collections | pass |

Checksum recheck: pass. See `../backups/BACKUP_VERIFICATION_20260721T181749Z.json`.

## Known gap

Artifacts are compressed but **not yet encrypted off-box**. An encrypted Restic
copy is blocked on `RESTIC_REPOSITORY` and a password source
(`RESTIC_PASSWORD_FILE` or `RESTIC_PASSWORD_COMMAND`) being configured. Until then
the dumps are a single-disk single point of failure.
