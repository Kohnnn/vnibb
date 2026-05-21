# Oracle Premium Rebuild Runbook (v1.3.0)

**Purpose:** Get `vnstock_news` and `vnstock_data` premium packages installed on the live Oracle container so insider deals + market news pipelines run with full coverage.

**Prerequisites:** SSH access to Oracle host `129.150.58.64` and `docker` on that host.

## Why this is needed

QA-v2 confirms:

- `POST /api/v1/market/news/crawl?limit=50&async_mode=false` returns `{"status":"success","message":"Crawled 0 articles","count":0}`. Confirms `vnstock_news` is NOT importable on the running container.
- `insider_deals` table count was 30 in v1, still stale in v2. Premium `vnstock_data.api.company.Company.insider_trading` required.
- Free RSS fallback (added in v1) keeps market_news partially fresh but loses semantic relevance vs the premium pipeline.

## Steps

### 1. Confirm Dockerfile is current

```bash
grep -A 8 "vnstock-cli-installer" apps/api/Dockerfile
```

Should show:

```dockerfile
ARG VNSTOCK_API_KEY
RUN if [ -n "$VNSTOCK_API_KEY" ]; then \
    /app/vnstock-cli-installer.run -- --api-key "$VNSTOCK_API_KEY" || \
    echo "WARNING: vnstock-cli-installer failed; runtime will rely on free-tier sources."; \
    fi
```

If missing, this was already restored in v1 — re-pull `main`.

### 2. Read API key

The key is in `.env` at the repo root:

```bash
VNSTOCK_API_KEY=<40 chars>
```

### 3. Build with build-arg

On the Oracle host:

```bash
cd /path/to/vnibb
git pull
docker build \
    --build-arg VNSTOCK_API_KEY="$VNSTOCK_API_KEY" \
    -t vnibb-api:1.3.0 \
    apps/api
```

### 4. Restart container

If using docker-compose:

```bash
docker compose up -d --no-deps --build api
```

If using plain docker:

```bash
docker stop vnibb-api && docker rm vnibb-api
docker run -d \
    --name vnibb-api \
    --env-file /path/to/.env \
    -p 8000:8000 \
    vnibb-api:1.3.0
```

### 5. Verify import

```bash
docker exec vnibb-api python -c "import vnstock_news; print(vnstock_news.__version__)"
docker exec vnibb-api python -c "import vnstock_data; print(vnstock_data.__version__)"
```

Both should print a version string. If either raises `ModuleNotFoundError`, the API key is invalid or the installer failed; check installer logs:

```bash
docker logs vnibb-api 2>&1 | grep -i vnstock
```

### 6. Run sync endpoints

```bash
# Refresh market news with premium fetcher
curl -s -X POST \
    "https://129.150.58.64.sslip.io/api/v1/market/news/crawl?limit=200&analyze_sentiment=false&async_mode=false" \
    -H "X-API-Key: $ADMIN_API_KEY"

# Sync insider deals
curl -s -X POST \
    "https://129.150.58.64.sslip.io/api/v1/data/sync/insider-deals?async_mode=false" \
    -H "X-API-Key: $ADMIN_API_KEY"

# Verify
curl -s "https://129.150.58.64.sslip.io/api/v1/market/freshness"
curl -s "https://129.150.58.64.sslip.io/api/v1/admin/database/freshness-summary" -H "X-API-Key: $ADMIN_API_KEY"
```

### 7. Expected post-state

- `market_news.status: "fresh"`.
- `insider_deals` table count > 30, ideally > 100 after a full sync.
- `GET /api/v1/equity/VCI/insider-deals?limit=10` returns ≥ 1 row.

## Rollback

If the new image misbehaves:

```bash
docker stop vnibb-api && docker rm vnibb-api
docker run -d --name vnibb-api ... vnibb-api:1.2.0   # previous tag
```

## Status as of v1.3.0 cycle

- ✅ Dockerfile premium installer is in place (re-enabled in v1 cycle).
- ✅ Free RSS fallback works without premium (cafef.vn, vietstock.vn, vneconomy.vn, baodautu.vn).
- ⚠️ Premium image rebuild is the operator-side action that completes the loop.
- ⚠️ Without it, `insider_deals` stays at v1 levels and market_news depends on free RSS only.
