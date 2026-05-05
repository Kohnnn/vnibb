# SSI iBoard Data Source Documentation

## Overview
**URL:** `https://iboard.ssi.com.vn/`
**Primary Data:** Real-time quotes, Market Depth, Stock Lists.
**Tech Stack:** React, MQTT over WebSocket.
**Auth:** None required for public data (uses guest access), but strict headers are enforced.

## API Endpoints

### 1. Stock Information (Symbol List)
**URL:** `https://iboard-query.ssi.com.vn/stock/stock-info`
**Method:** `GET`
**Description:** Returns the full list of supported symbols, exchanges, and metadata.
**Response:**
```json
{
  "code": "SUCCESS",
  "data": [
    {
      "symbol": "SSI",
      "name": "SSI",
      "exchange": "HOSE",
      "fullName": "SSI",
      "clientName": "Công ty Cổ phần Chứng khoán SSI",
      "type": "s"
    },
    ...
  ]
}
```

### 2. Market Snapshot (Group Data)
**URL:** `https://iboard-query.ssi.com.vn/stock/group/{GROUP}`
**Method:** `GET`
**Groups:** `VN30`, `HOSE`, `HNX`, `UPCOM`, `VN100`
**Description:** Returns a snapshot of price data for all stocks in the group.
**Response:**
```json
{
  "code": "SUCCESS",
  "data": [
    {
      "stockSymbol": "ACB",
      "matchedPrice": 25500,
      "priceChange": 500,
      "priceChangePercent": 2.0,
      "totalVolume": 1500000,
      // ... deep market data
    }
  ]
}
```

### 3. Real-time Streaming (WebSocket)
**URL:** `wss://price-streaming.ssi.com.vn/mqtt`
**Protocol:** MQTT over WebSocket
**Topics:** Likely `stock/price/{SYMBOL}` or `stock/group/{GROUP}`. *(Requires further MQTT protocol analysis if full streaming is needed)*.

## Required Headers
The API is protected and checks for browser-like headers.
```python
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://iboard.ssi.com.vn/',
    'Origin': 'https://iboard.ssi.com.vn'
}
```

## Integration Strategy
1.  **Reference Data:** Use `/stock/stock-info` to sync the master list of symbols.
2.  **Snapshot Update:** Use `/stock/group/{GROUP}` to get fast snapshots of the entire market or specific groups without needing to maintain a complex WebSocket connection for everything.
3.  **Real-time:** Use WebSocket for watching specific "Hot" stocks or the user's portfolio.

## Notes
- **Rate Limiting:** Unknown, but likely high capacity.
- **Data Quality:** Very high ("Gold Standard").
- **Market Depth:** Available in snapshot and streaming data.
