# API Reference (V52)

Date: 2026-02-22

This document captures the current VNIBB v1 API surface used by the web app and operations workflows.

Base URL:
- Local: `http://localhost:8000/api/v1`
- Production (current OCI deployment): `https://213.35.101.237.sslip.io/api/v1`

## Conventions

- Response envelope (most endpoints):
  - `{"error": boolean, "code"?: string, "message"?: string, "data"?: any, "cached"?: boolean}`
- Standard symbol params are uppercase ticker strings (example: `VNM`, `FPT`, `VCB`).
- Timeout behavior:
  - API middleware defaults to a 30s request timeout for non-health routes.
  - Timeout responses return `504` with `code=REQUEST_TIMEOUT`.

## Endpoint Groups

The v1 router mounts the following endpoint groups:
- `/comparison`, `/sectors`, `/equity`, `/screener`, `/financials`, `/dashboard`, `/user`, `/data`
- `/stream`, `/analysis`, `/market`, `/news`, `/listing`, `/trading`, `/derivatives`
- `/copilot`, `/rs`, `/admin`, `/chart-data`
- Additional aliases: `/compare` (analysis alias), market-news alias routes under `/market`, websocket and export routes mounted without an extra prefix.

## Frontend-Consumed Endpoints (Current)

These are the paths used by `apps/web/src/lib/api.ts`.

### Equity
- `GET /equity/historical`
- `GET /equity/{symbol}/quote`
- `GET /equity/{symbol}/profile`
- `GET /equity/{symbol}/news`
- `GET /equity/{symbol}/events`
- `GET /equity/{symbol}/shareholders`
- `GET /equity/{symbol}/officers`
- `GET /equity/{symbol}/intraday`
- `GET /equity/{symbol}/foreign-trading`
- `GET /equity/{symbol}/subsidiaries`
- `GET /equity/{symbol}/ratios`
- `GET /equity/{symbol}/ratios/history`
- `GET /equity/{symbol}/metrics/history`
- `GET /equity/{symbol}/income-statement`
- `GET /equity/{symbol}/balance-sheet`
- `GET /equity/{symbol}/cash-flow`
- `GET /equity/{symbol}/financials`
- `GET /equity/{symbol}/dividends`
- `GET /equity/{symbol}/trading-stats`
- `GET /equity/{symbol}/ownership`
- `GET /equity/{symbol}/rating`
- `GET /equity/{symbol}/orderbook`
- `GET /equity/{symbol}/peers` (V50)
- `GET /equity/{symbol}/ttm` (V50)
- `GET /equity/{symbol}/growth` (V50)

### Comparison / Screener / Sector
- `GET /comparison/performance`
- `GET /comparison`
- `GET /comparison/{symbols}` (path alias for symbols CSV)
- `GET /screener/`
- `GET /screener` (no-trailing-slash compatibility route)
- `GET /sectors`
- `GET /sectors/{sector}/stocks` (V50)
- `GET /sectors/top-movers`

### Market
- `GET /market/indices`
- `GET /market/world-indices`
- `GET /market/forex-rates`
- `GET /market/commodities`
- `GET /market/top-movers`
- `GET /market/sector-performance`
- `GET /market/heatmap`
- `GET /market/research/rss-feed`

Market data notes:
- `GET /market/indices` is a mixed-source snapshot for `VNINDEX`, `VN30`, `HNX`, and `UPCOM`.
- Yahoo Finance is the fast path for mapped symbols. Any required index missing from Yahoo falls back to `vnstock` before persisted DB rows are used as a last-known snapshot.
- Yahoo Vietnam quotes are delayed by the exchange/data-provider terms; they should be treated as delayed market data rather than exchange-native realtime data.
- The web header overlays the snapshot with WebSocket index updates during market hours when the realtime channel is available.

### Listing / Trading / Derivatives
- `GET /listing/symbols`
- `GET /listing/exchanges`
- `GET /listing/groups/{group}`
- `GET /listing/industries`
- `GET /trading/price-board`
- `GET /trading/top-gainers`
- `GET /trading/top-losers`
- `GET /trading/top-volume`
- `GET /trading/top-value`
- `GET /trading/sector-top-movers`
- `GET /derivatives/contracts`
- `GET /derivatives/{symbol}/history`

### Insider / Alerts
- `GET /insider/{symbol}/deals`
- `GET /insider/recent`
- `GET /insider/{symbol}/sentiment`
- `GET /insider/block-trades`
- `GET /alerts/insider`
- `POST /alerts/{alertId}/read`
- `GET /alerts/settings`

### AI / Technical / RS
- `POST /copilot/ask`
- `GET /copilot/suggestions`
- `GET /copilot/prompts`
- `GET /analysis/ta/{symbol}/full`
- `GET /analysis/ta/{symbol}/history`
- `GET /rs/leaders`
- `GET /rs/laggards`
- `GET /rs/gainers`
- `GET /rs/{symbol}`

### Utility / Admin
- `GET /dashboard/`
- `POST /dashboard/`
- `PATCH /dashboard/{dashboard_id}`
- `DELETE /dashboard/{dashboard_id}`
- `GET /chart-data/{symbol}`
- `GET /admin/data-health`
- `POST /admin/data-health/auto-backfill`

Dashboard persistence notes:
- Frontend dashboard layout, tabs, and per-widget config state are persisted through the dashboard endpoints when the active dashboard has a backend ID.
- Widget-local state that used to live in separate browser keys is being consolidated into widget config so it can follow normal dashboard persistence and migration paths.
- This now covers widget-owned state such as notes, watchlists, price alerts, peer-comparison saved sets, and research-browser saved sources.
- Legacy widget aliases are normalized on load before dashboards are re-saved. Current canonical widget IDs include `ticker_profile`, `unified_financials`, `major_shareholders`, and `database_inspector`.

## Request/Response Examples

### 1) Quote

Request:
```http
GET /api/v1/equity/VNM/quote
```

Response (trimmed):
```json
{
  "error": false,
  "data": {
    "symbol": "VNM",
    "price": 65800,
    "change": 300,
    "changePct": 0.46,
    "volume": 1842100,
    "updatedAt": "2026-02-22T09:30:00+07:00"
  },
  "cached": true
}
```

### 2) Screener

Request:
```http
GET /api/v1/screener?exchange=HOSE&limit=50
```

Response (trimmed):
```json
{
  "error": false,
  "data": {
    "rows": [
      { "symbol": "VNM", "market_cap": 137000000000 }
    ],
    "total": 50
  }
}
```

### 3) Peers (V50)

Request:
```http
GET /api/v1/equity/VNM/peers
```

Response (trimmed):
```json
{
  "error": false,
  "data": {
    "symbol": "VNM",
    "peers": ["MCM", "MML", "QNS"]
  }
}
```

### 4) Growth (V50)

Request:
```http
GET /api/v1/equity/VNM/growth?period=quarterly
```

Response (trimmed):
```json
{
  "error": false,
  "data": {
    "revenue_growth": 0.082,
    "earnings_growth": 0.064,
    "period": "quarterly"
  }
}
```

## Deployment Verification Checklist

After backend deployment, run these probes:
- `GET /api/v1/equity/VNM/peers` returns `200`
- `GET /api/v1/equity/VNM/ttm` returns `200`
- `GET /api/v1/equity/VNM/growth` returns `200`
- `GET /api/v1/sectors/banking/stocks` returns `200`
- `GET /api/v1/comparison/VNM,FPT,VCB` returns `200`
- `GET /api/v1/screener` does not redirect (no `307`)
- `GET /api/v1/market/heatmap` returns `200` with either populated sectors or empty-state payload
