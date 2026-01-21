# Vietcap Screener Documentation

## Overview
**URL:** `https://trading.vietcap.com.vn/iq/screening`
**Tech Stack:** React (CSR)
**Data Source:** Internal JSON API (Vietcap IQ Insight Service)

## API Endpoints

### 1. Stock Screening (Main Endpoint)
**URL:** `https://iq.vietcap.com.vn/api/iq-insight-service/v1/screening/paging`
**Method:** `POST`
**Content-Type:** `application/json`

**Request Payload:**
```json
{
  "page": 1,
  "pageSize": 50,
  "sort": {
    "field": "marketCap",
    "direction": "desc"
  },
  "criteria": [
    // Example criteria (filters)
    {
      "code": "exchange",
      "value": ["HOSE", "HNX"]
    },
    {
      "code": "marketCap",
      "from": 1000,
      "to": 500000
    }
  ]
}
```

**Response Structure:**
```json
{
  "data": {
    "content": [
      {
        "symbol": "VCB",
        "companyName": "Ngan hang thuong mai co phan Ngoai thuong Viet Nam",
        "marketPrice": 92000,
        "marketCap": 500000,
        "dailyPriceChangePercent": 1.2,
        "stockStrength": 75.5,
        "accumulatedVolume": 1500000,
        "accumulatedValue": 138000000000,
        "tradingValueAdtv10Days": 120000000000,
        "pe": 15.2,
        "pb": 3.1,
        "roe": 20.5
        // ... other metrics based on available fields
      }
      // ... more stocks
    ],
    "totalElements": 150,
    "totalPages": 3
  }
}
```

### 2. Available Filters & Metrics
**URL:** `https://iq.vietcap.com.vn/api/iq-insight-service/v1/screening/criteria`
**Method:** `GET` or `POST` (Check implementation)

**Description:** Returns the list of available filter codes (e.g., `marketCap`, `pe`, `rsi`, `macd`) and their allowed ranges or values.

## Key Data Points for Integration
- **Market Data:** `marketCap`, `marketPrice`, `accumulatedVolume`, `tradingValueAdtv10Days`
- **Technical Signals:** `stockStrength` (Relative Strength), `rsi`, `macd`, `adx`
- **Valuation:** `pe`, `pb`, `ev_ebitda` (check availability in criteria)
- **Growth:** Revenue growth, Profit growth

## Integration Strategy
1.  **Dynamic Filtering:** Fetch standard metrics for all stocks by setting `pageSize` to a large number (or paginating).
2.  **Mapping:** Map `symbol` to our database `symbol`.
3.  **New Metrics:** Extract `stockStrength` (RS rating) and `tradingValueAdtv10Days` (Liquidity) which are useful for screening.
4.  **No Auth Required:** The API appears to work without strict authentication for public access, but check if `User-Agent` or specific headers are enforced.

## Notes
- No public "Export" button found.
- Data is rich and structured, ideal for filling gaps in `vnstock` data.
