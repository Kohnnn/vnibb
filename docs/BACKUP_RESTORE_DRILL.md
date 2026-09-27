# Backup and off-box recovery drill

Two different checks answer different questions. `scripts/oracle/verify-backup.sh [stamp]` checks an OCI-hosted set: SHA-256 and byte length for every manifest artifact, strict PostgreSQL scratch restore, producer TABLE DATA count against the dump TOC, nonempty restored `stocks`/`stock_prices`, and successful scratch-database/staged-dump cleanup **before** reporting `VERIFY OK`. A cleanup failure exits nonzero and names the artifact to remove. It performs no live database reads; its scratch database is random by default and an explicitly named existing database is never replaced. **It is not disaster recovery**: it depends on that host and does not prove Mongo recovery. `scripts/oracle/restore-offbox.py` consumes the **already copied** Postgres+Mongo pair on a separate workstation and starts fresh, disposable local databases. It never contacts a source database or uses the production compose stack.

## The producer on the OCI node

`scripts/oracle/vnibb-backup.sh` runs on the host, installed as `/usr/local/sbin/vnibb-backup.sh` with a cron entry. It needs `bash` (4.4+), `python3`, `stat`, `df`, `sha256sum`, `head`, `od`, `tr`, `grep`, `find`, `sort`, `cut`, `sed`, and Docker access to the `vnibb-db` and `vnibb-mongo` containers. Inside those containers it runs `pg_dump`, `pg_restore`, `mongodump`, `rm`, `df` and `stat`, all present in the pinned `supabase/postgres:17.6.1.136` and `mongo:7` images. **The OCI host does not need `pg_restore`:** the archive TOC is read by piping the host dump into `docker exec -i vnibb-db pg_restore --list`. It pulls no images and uses no network. It writes one `deployment/backups/<UTC stamp>/` set whose `manifest.json` lists only the `postgres-<stamp>.dump` and `mongo-vnibb-market-<stamp>.archive.gz` payloads with their byte lengths and SHA-256 hashes; the manifest does not list itself.

### Disk preflight

Before it creates the set directory or runs either dump, the script estimates disk demand. The host filesystem holding `BACKUP_DIR` needs the compressed PostgreSQL dump, **two** copies of the estimated Mongo archive (container staging and host destination can share the OCI root disk), a stream buffer and `HOST_SAFETY_RESERVE_BYTES` (default 5 GiB). It checks the container temp and data paths separately and refuses if a free-space reading is unavailable. PostgreSQL streams to the host, so its container temp and data paths need only `CONTAINER_SAFETY_RESERVE_BYTES` (default 64 MiB) for server temp/WAL/log activity, not a second dump-sized staging file. Mongo's temp and data paths each need the estimated archive plus that reserve.

Container probes use portable `df -Pk`; the host parses available 1-KiB blocks
into bytes. GNU-only `df --output` is not supported by the pinned PostgreSQL
image's BusyBox utilities. Missing, stopped, unreadable or malformed container
probes fail before dumping. The host probe may use GNU `df`.

With a previous successful paired set, estimates use its manifest artifact byte counts multiplied by `PG_GROWTH_MARGIN_PCT` (default 150%) and `MONGO_GROWTH_MARGIN_PCT` (default 200%). Without usable prior counts, `PG_MIN_EXPECTED_BYTES` (default 16 GiB) and `MONGO_MIN_EXPECTED_BYTES` (default 256 MiB) apply. The preflight is an estimate, **not a write limit**; an unexpectedly larger dump can still exhaust a disk, so monitor headroom before enabling cron. Uncompressed database-directory sizes are not dump-size estimates. A refusal leaves a `<stamp>.FAILED` marker but no set directory or database writes.

### Artifacts and failure handling

The Postgres dump is streamed: `pg_dump -Fc` writes to stdout and the host redirects it to `postgres-<stamp>.dump`, so the dump exists once instead of in the container and on the host. The producer rejects empty or implausibly tiny dumps and checks the TOC in the PostgreSQL container; it does **not** reject a smaller-than-last-time dump, because retention can legitimately shrink the database. The Mongo archive is staged in its container `/tmp`, copied to the host once and then removed; a staging removal that fails is reported with its exact path.

A run that fails **before** verification removes only its own incomplete set directory; previous good sets are never removal candidates. `KEEP_SETS` (default 7) is operator-controlled, and older sets are pruned only after the new pair and manifest have been verified. If removal of an old set fails, the script exits nonzero and reports `RETENTION FAILURE`, but **keeps the newly verified pair** rather than deleting it; inspect the remaining old set manually before the next scheduled backup.

```bash
sudo /usr/local/sbin/vnibb-backup.sh       # runs from cron; exits non-zero on failure
scripts/oracle/verify-backup.sh            # then verify the newest set on the node
```

## Select an actual paired set

The OCI backup producer writes `deployment/backups/<UTC stamp>/manifest.json`, `postgres-<stamp>.dump`, and `mongo-vnibb-market-<stamp>.archive.gz`. Pull the *entire* directory to an off-box host, preserving its manifest and exact filenames. Older workstation sets use `BACKUP_VERIFICATION_<stamp>.json`, `supabase-<stamp>.dump`, and `vnibb-market-<stamp>.archive.gz` in one directory. The recovery utility supports either layout; it requires matching stamp, byte length and SHA-256 for **both** artifacts. A manifest is required; a dump alone is insufficient. Protect the manifest's origin (for example, authenticate the transfer over Tailscale/SSH); checksums detect accidental corruption, not a maliciously replaced dump and manifest.

A fresh host needs Python 3.11+, Docker daemon access, enough disk for both expanded datasets, and locally available `supabase/postgres:17.6.1.136` and `mongo:7` images. Pull the pinned images on a networked host before the drill; the utility does not pull images or access the network. On an operator-controlled workstation, if Docker access requires non-interactive sudo, it tries `sudo -n docker` rather than prompting. Do not run it on the production host or point it at production backup paths. Inspect the chosen path, then acknowledge it explicitly:

```bash
python3 scripts/oracle/restore-offbox.py --confirm-isolated --stamp 20260729T190249Z ../backups
# or for a current producer set:
python3 scripts/oracle/restore-offbox.py --confirm-isolated /offbox/backups/20260922T133456Z
```

The historical workstation directory contains multiple manifests, so select one with `--stamp` (the example selects the paired July 29 set). With exactly one manifest, `--stamp` may be omitted. A partial set (e.g. PostgreSQL only) is rejected, not called recovered.

The utility verifies bytes before creating anything, checks both images exist, assigns unpredictable per-run container names, and launches fresh throwaway PostgreSQL/Mongo containers with `--network none`, no host ports, no source-volume mount, and a read-only mount of the copied artifacts. It creates a new PostgreSQL database from `template0`, uses `pg_restore --exit-on-error --no-owner --no-privileges`, and restores Mongo with `--gzip --stopOnError` restricted to `vnibb-market.*`. It checks public-table count plus nonempty `stocks` and `stock_prices`, Mongo collection and populated-collection counts plus nonempty `market_prices_eod` and a sample document. For older verification manifests it additionally checks their recorded public-table and collection counts. A failure exits nonzero; containers are removed in `finally` even on restore failure. Do not copy the production env file or credentials into the drill.

The temporary PostgreSQL bootstrap password is passed through the Docker child process environment—not in Docker argv. If daemon access requires `sudo -n`, the utility preserves only `POSTGRES_PASSWORD` for that one `docker run`; without it, the database does not start. Subprocess errors report exit status/timeout only. Before success, the utility attempts removal of **both** planned containers and confirms neither remains in `docker ps -a`; any removal/confirmation failure is nonzero and suppresses `RECOVERY OK`. Thus successful recovery requires both data assertions and confirmed absence of plaintext restored containers.

PostgreSQL readiness probes TCP at `127.0.0.1` inside the isolated container. The image's temporary initialization server accepts Unix-socket connections before it shuts down; accepting that server as ready races `createdb` against initialization. TCP readiness selects the final server instead.

`RTO_seconds` measures local SHA-256 verification, container startup, both restores, and data assertions until the stores can be queried. Container cleanup is required before `RECOVERY OK`, but is not included in this measurement. It excludes off-box transfer, rebuilding application services, DNS cutover and user-visible recovery; it is **not** an end-to-end service RTO. Capture the set ID, checksums, counts, elapsed time, exit status and host/image versions in the drill record. The live verifier has a different scope and must not be counted as this result.

## Current workstation evidence and open risks

### 2026-09-26: current paired backup restored

The off-host pair `../backups/20260924T175056Z` passed SHA-256/byte verification,
strict fresh-target PostgreSQL and MongoDB restores, data assertions, and
confirmed recovery-container removal. The utility exited 0 with
`RECOVERY OK` and `RTO_seconds=2860.5` (47 minutes 40.5 seconds; excludes
transfer and application cutover).

- PostgreSQL: 39 public tables, 1,753 `stocks`, 1,748,069 `stock_prices`.
  The manifest's 87 TABLE DATA entries are not a public-table count.
- MongoDB: 7,983,753 documents restored, zero failures; 16 populated collections.
  Largest: `market_prices_eod`, 4,870,705 documents; sampled document present.
- PostgreSQL artifact: 9,895,265,236 bytes,
  SHA-256 `6fb6f6984b579a95c8d0fe017346e015361bb668753ab326e122ec7a7c01f73d`.
- Mongo artifact: 393,311,823 bytes,
  SHA-256 `7886f051e4b250e3e775caca49f079886ccf276c17aad828fa88b5c117146932`.
- Host: Linux `7.1.5-76070105-generic`, Docker `29.1.3`.
  Image `supabase/postgres:17.6.1.136`:
  `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`;
  image `mongo:7`:
  `sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca`.

This proves recovery of the September 24 pair, not current production freshness.
The operator subsequently chose snapshot cleanup rather than storage expansion;
see the incident handoff in `oracle_runbook.md`. After cleanup, the portable
producer completed fresh paired set `20260926T053513Z`: PostgreSQL dump
1,355,316,151 bytes, 90 TABLE DATA entries, and Mongo archive 393,300,936 bytes.
After transfer, both hashes and sizes passed and the isolated restore exited 0
with `RECOVERY OK`, `RTO_seconds=376.0`: 42 public PostgreSQL tables, 1,754 stocks,
1,748,069 stock prices; 7,983,753 Mongo documents restored with zero failures,
16 populated collections, 4,870,705 EOD prices and a sampled document present.
Both disposable containers were removed before success.

### Historical drill and custody risks


On 2026-09-23 the **historical** workstation pair `20260729T190249Z` was restored by this independent utility in fresh `supabase/postgres:17.6.1.136` and `mongo:7` containers. Both manifest SHA-256 and byte-size checks passed; PostgreSQL restored 37 public tables, 1,742 `stocks` rows and 1,745,922 `stock_prices` rows; Mongo restored 7,964,485 documents with zero failures into 16 populated collections (largest `market_prices_eod`: 4,851,437 documents), and its sampled document was present. The final utility's verified run exited 0 with `RTO_seconds=141.1` for local verification through assertions; no recovery containers remained after its cleanup. An earlier 130.3-second run predates the final Mongo-start/cleanup fixes and is not the release proof. This proves the historical pair on this workstation, **not current RPO**. A newer `vnibb-20260922T131323Z.dump` is a lone 1.8 GB PostgreSQL dump without a matching Mongo artifact/manifest in that directory; it cannot be paired with the July Mongo archive because their timestamps and consistency points differ. Remote OCI backup state cannot be asserted from this local copy alone (Tailscale SSH currently requires interactive reauthentication).

**Encryption/key decision:** the historical plaintext files remain unchanged; an additional encrypted copy `../backups/20260729T190249Z-offbox.tar.age` (467,437,160 bytes, SHA-256 `9ba823c26683eb17964aceb6be0d23d74036d3978c9c9dcb4d03bb03d3a2b476`) was created with `age` recipient `age1lu9gvw3vvrghvzqf5fkn5rr2td86h4z0egtrs6cdgrnt3jcyj5hq0y9akg`. Decryption with the locally held identity independently reproduced the manifest and both original dump SHA-256 values, then the plaintext pair passed the fresh-target restore above. The identity currently lives at `/home/compute_01/.local/share/vnibb-recovery/identity` with mode 0600 (directory mode 0700), **outside git and outside the backup directory**. This is local encryption and decryption proof, **not independent key recovery**: losing this workstation can lose this sole key. Before treating this as disaster-resilient custody, an authorized operator must place a securely wrapped copy of the identity in a separate access-controlled secret store/offline medium, give a second authorized recovery holder access, and perform a decryption drill on a different machine. Do not upload or commit the raw identity, passwords, plaintext dumps or production `.env` files. Keep existing plaintext protected until key escrow and independent restore are proven, then retire plaintext through an approved retention process. The old off-box copies are still **unencrypted at rest**, and the new `.age` file is on this workstation only; confidentiality and geographic resiliency remain open. Restic/OCI Object Storage is not currently the working transport: bucket authorization was denied; the Tailscale workstation pull is the off-box leg.

To recover the encrypted copy once the identity is independently available, copy the `.age` file to a fresh machine and decrypt to a private scratch directory; never place the key alongside the only encrypted backup:

```bash
set -o pipefail
umask 077
mkdir -p /private/recovery-20260729 # use an operator-owned private path with adequate disk
printf '%s  %s\n' '9ba823c26683eb17964aceb6be0d23d74036d3978c9c9dcb4d03bb03d3a2b476' '../backups/20260729T190249Z-offbox.tar.age' | sha256sum -c -
age -d -i /secure/separate/identity ../backups/20260729T190249Z-offbox.tar.age | tar -x -C /private/recovery-20260729
python3 scripts/oracle/restore-offbox.py --confirm-isolated /private/recovery-20260729
```

The extraction command assumes this specific locally created archive; do not unpack untrusted archives without inspecting member paths. Preserve provenance and verify the encrypted file SHA-256 before decryption. The utility rechecks both extracted artifacts against their manifest before starting databases.
