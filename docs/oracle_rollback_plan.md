# Oracle Rollback Plan

## Rollback Triggers

- `/ready` remains non-200 after cutover
- Sustained 5xx increase
- Websocket instability
- Broken auth/session flow
- Unacceptable latency regression

## Rollback Steps

1. Point the stable hostname back to the previous managed host origin.
2. Confirm the previous managed host health endpoints:
   - `/live`
   - `/ready`
   - `/health/`
3. Confirm the Vercel frontend recovers against the stable hostname.
4. Keep Oracle running for forensic review, but out of traffic.
5. Capture Oracle API logs, Caddy logs, and the last health/smoke outputs.
6. Open follow-up incident tasks before any retry.

## Rollback Validation

- Run the same health checks used for cutover
- Confirm CORS for the Vercel origin
- Confirm key equity endpoints return `200`
- Confirm login/session flow still works

## Post-Rollback Notes

Save:

- DNS change timestamps
- Oracle API logs
- Oracle reverse-proxy logs
- Health and smoke script output
- Error-rate and latency screenshots

Do not retry cutover until:

- the root cause is identified
- env drift is corrected
- the failing check has a passing preflight on the Oracle canary hostname

## Image Rollback (application releases)

The plan above covers the Vercel -> Oracle cutover. This section covers rolling
back a *release*, which is the common case and is fast because every service is
pinned to an immutable digest.

### How the pin works

`deployment/env.oracle` pins both halves of the reference:

```
VNIBB_API_IMAGE_REPOSITORY=ghcr.io/kohnnn/vnibb-api
VNIBB_API_IMAGE_DIGEST=sha256:<digest>
```

`docker-compose.oracle.yml` consumes them as
`${VNIBB_API_IMAGE_REPOSITORY}@${VNIBB_API_IMAGE_DIGEST}`, and both are
declared with `:?` so compose refuses to start if either is unset. A tag is
never used at runtime, so a re-pushed tag cannot silently change what runs.

### Rollback procedure

1. Identify the last known-good digest. Every release records the revision it
   was built from, and `/health/detailed` reports it:

   ```
   curl -s https://<host>/health/detailed | jq -r .revision
   ```

   This must equal the commit the image was built from. If it does not, the
   running container is not the release you think it is.

2. Set `VNIBB_API_IMAGE_DIGEST` in `deployment/env.oracle` back to the
   previous digest.

3. Recreate only the affected services (never `down` the stack):

   ```
   docker compose --env-file deployment/env.oracle \
     -f docker-compose.oracle.yml up -d --no-deps api scheduler mcp
   ```

4. Confirm the rollback took effect by re-reading `/health/detailed` and
   checking `revision` matches the intended commit.

5. Run the smoke gate against the host:

   ```
   scripts/oracle/smoke_test.sh
   ```

### Migration caveat

A release may add an Alembic migration. Rolling the *image* back does not roll
the *schema* back. Two rules follow:

* Prefer backwards-compatible migrations (add column, add constraint,
  backfill) so the previous image still runs against the newer schema.
* If a migration is genuinely destructive, take a fresh backup first. Restores
  are proven with `scripts/oracle/verify-backup.sh`, which restores into a
  scratch database and asserts table parity before anything is swapped.

   ```
   scripts/oracle/vnibb-backup.sh
   scripts/oracle/verify-backup.sh          # newest set
   ```

### Do not

* Do not roll back by editing a tag. Digests are the contract.
* Do not `docker compose down` during a rollback; it drops the network and
  orphans the database containers mid-incident.
* Do not retry the failed release until `/health/detailed` reports a revision
  that matches a digest you can point at.
