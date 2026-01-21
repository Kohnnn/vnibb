# Web Scraping Data Sources - Overview

## Summary Comparison

| Site | Difficulty | Best For | Anti-Scrape | Approach |
|------|------------|----------|-------------|----------|
| **cophieu68.vn** | 🟢 Easy | Bulk data, financials, prices | None | Simple HTTP + BeautifulSoup |
| **24hmoney.vn** | 🟡 Medium | Transaction flow, sector analysis | Minimal | Nuxt extraction / API |
| **finance.vietstock.vn** | 🔴 Hard | Order statistics | High | Headless browser required |
| **sieucophieu.vn** | 🟡 Medium | Industry cashflow | Moderate | Public API + browser |

---

## Recommended Data Source Strategy

### Primary Sources (Most Reliable)

#### 1. Cophieu68.vn - Core Data
| Data Type | Endpoint | Frequency |
|-----------|----------|-----------|
| Daily OHLCV (all stocks) | `/download/historydaily.php` | Daily at 16:00 |
| Financial Ratios | `/signal/filter_financial.php` | Weekly |
| Foreign Activity | `/stats/foreigner.php` | Daily |
| Stock Listings | `/market/markets.php?vt=1` | Weekly |

#### 2. SieuCoPhieu API - Industry Flow
| Data Type | Endpoint | Frequency |
|-----------|----------|-----------|
| Industry Cashflow | `/api/v1/stock/industry_cashflow/` | 4x daily |

### Secondary Sources (Supplementary)

#### 3. 24HMoney - Enhanced Data
| Data Type | Endpoint | Frequency |
|-----------|----------|-----------|
| Sector Money Flow | `/recommend/business` | Daily |
| Transaction Details | `/stock/{SYMBOL}/transactions` | On-demand |

#### 4. Vietstock - Order Statistics (Optional)
| Data Type | Endpoint | Frequency |
|-----------|----------|-----------|
| Market Order Flow | `/ket-qua-giao-dich?tab=thong-ke-dat-lenh` | Daily |

> ⚠️ Use Vietstock only if order statistics are critical; high anti-scrape friction.

---

## Database Updates Strategy

### Robust Update Process

```
┌─────────────────────────────────────────────────────────────────┐
│                    Data Collection Pipeline                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. FETCH → Raw data from multiple sources                     │
│   2. VALIDATE → Schema validation, range checks                  │
│   3. TRANSFORM → Normalize formats, convert units               │
│   4. DEDUPLICATE → Merge data from multiple sources             │
│   5. STAGE → Write to staging tables                            │
│   6. VERIFY → Compare with existing data, flag anomalies        │
│   7. COMMIT → Atomic update to production tables                │
│   8. LOG → Record update metadata and statistics                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Validation Rules

| Field | Validation |
|-------|------------|
| Price | > 0, < 10,000,000 VND |
| Volume | >= 0, integer |
| P/E | -1000 < x < 1000 |
| ROE | -100% < x < 1000% |
| Market Cap | > 0 |

### Conflict Resolution
When same data from multiple sources:
1. Trust cophieu68 for prices (most reliable)
2. Trust 24hmoney for active buy/sell flow
3. Average numeric values if close (±5%)
4. Flag large discrepancies for review

---

## Detailed Documentation

- [Cophieu68 Documentation](./cophieu68_documentation.md)
- [24HMoney Documentation](./24hmoney_documentation.md)
- [Vietstock Documentation](./vietstock_documentation.md)
- [SieuCoPhieu Documentation](./sieucophieu_documentation.md)
