# Private MongoDB Connectivity Plan

## Goal

Connect the deployed VNIBB API to a privately hosted MongoDB analytical datastore without exposing MongoDB to the public internet.

## Architecture

```text
Frontend
  -> public API gateway
  -> private overlay network
  -> private MongoDB host
```

MongoDB remains an analytical market-data source. It is not the auth store, dashboard state store, or replacement for the documented Appwrite/Supabase split.

## Scope

- Host MongoDB on a private always-on machine with enough disk.
- Connect the API host to MongoDB through a private overlay network.
- Keep MongoDB credentials and host-specific connection details out of repo-facing docs.
- Start with a cache-limited MongoDB container because the private host has constrained RAM.
- Import market data gradually and benchmark API/widget latency before expanding retention.

## Runtime Constraints

- MongoDB must not be reachable from the public internet.
- MongoDB should be firewalled to private overlay-network clients only.
- Keep `STORE_INTRADAY_TRADES=false` at first.
- Start with 5-year EOD/selected analytical datasets before attempting broader retention.
- Keep the private host awake and plugged in if it backs production-like API paths.

## VNIBB Runtime Variables

Use environment-specific values outside repo-facing docs:

```text
MONGODB_ENABLED=true
MONGODB_DATABASE=frb
MONGODB_URL=<private-overlay-mongodb-uri>
MONGODB_TIMEOUT_MS=10000
PRICE_HISTORY_YEARS=5
STORE_INTRADAY_TRADES=false
```

## Benchmark Checklist

- API host can reach MongoDB over the private overlay network.
- MongoDB authentication works from the API host.
- Historical price endpoint can serve a known liquid ticker from MongoDB.
- Quant widgets using EOD data return within acceptable latency.
- Microstructure widgets fail gracefully when intraday data is absent.
- API remains healthy when MongoDB is temporarily unavailable.
- Disk, memory, and MongoDB container restart count remain stable during tests.

## Rollback

If MongoDB connectivity causes runtime issues:

```text
MONGODB_ENABLED=false
```

Then restart the API service. Supabase/Appwrite paths remain unchanged.
