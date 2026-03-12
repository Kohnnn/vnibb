# Oracle Rollback Plan

## Rollback Triggers

- `/ready` remains non-200 after cutover
- Sustained 5xx increase
- Websocket instability
- Broken Appwrite auth/session flow
- Unacceptable latency regression

## Rollback Steps

1. Point the stable hostname back to the Zeabur origin.
2. Confirm Zeabur health endpoints:
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
