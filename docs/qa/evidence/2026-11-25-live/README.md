# Live database-backed browser QA — 25 Nov 2026

Observation window: **2026-11-25 05:44–05:45 UTC (12:44 ICT)**, `https://web.vnibb.xyz/`. Visible release badge: **v1.5.0**; global health: **Degraded — Data validation degraded**. Browser session was read-only; no login, refresh, workspace edits, provider acquisition, export, or settings change.

The separate running API probe at 05:13–05:14 UTC reported API revision `db1926523c15c6e25b5673b0294e571574163ef5`, detailed health degraded, verified screener universe unavailable. GitHub's last Production frontend deployment record still points to `df6a6d6f35c1e5bcee60d67b79c81c351530d425`; the visible web alias is not bound here to an immutable frontend source revision. Database census at 05:48 UTC, after browser capture, is recorded in issue #274 comment 7154415283.

## Captures

| File | URL/surface | Observed state |
|---|---|---|
| `hpg-fundamental-ownership.webp` | `/dashboard?dashboard=default-fundamental&tab=tab-default-fundamental-ownership&symbol=HPG` | 2 reported shareholders; ownership partial/as-of unknown; holder percentages unavailable. Ownership rating local-only `n/a`, refresh failed (as-of 27 Oct); foreign flow request unavailable with cached fallback; 56/20 sessions observed and 20D withheld. Market cap/share count unavailable. P/E 11.98, P/B 1.54; quote 21,250, volume 32.47M, +4.17%. Executives pending/0, subsidiaries 0. |
| `mwg-fundamental-ownership.webp` | `/dashboard?dashboard=default-fundamental&tab=tab-default-fundamental-ownership&symbol=MWG` | 20 reported shareholders; partial/as-of unknown; percentages unavailable. Ownership rating local-only `n/a`, refresh failed (as-of 2 Nov); foreign flow request unavailable with cached fallback; 53/20 sessions observed and 20D withheld. Market cap/share count unavailable. P/E 18.51, P/B 3.94; quote 72,300, volume 2.05M, -14.00%. Executives/subsidiaries unavailable or zero. |
| `mwg-technical-overview.webp` | `/dashboard?dashboard=default-technical&tab=tab-default-technical-overview&symbol=MWG` | 1Y candlesticks rendered; last label 72,300. Partial price history, source/as-of unknown, adjusted VND, session basis unverified, adjustment coverage 0%. Signal summary unavailable because historical price units are uncertified. |
| `mwg-quant-dashboard.webp` | `/dashboard?dashboard=default-quant&symbol=MWG` | Risk dashboard unavailable for unresolved source quality; volume profile local/cached (source date 3 Nov per settled text); momentum insufficient history; drawdown showed 0 sessions versus minimum 30. Other tiles still preparing/loading at screenshot time. |
| `mwg-global-markets.webp` | `/dashboard?dashboard=default-global-markets&symbol=MWG&tab=tab-default-global-markets-global-markets` | TradingView tiles loading; multiple forex/heatmap/news/derivatives cards `PREPARING WIDGET`; source/as-of unknown or local-only. This is a captured preparation state, not a settled endpoint failure. |

## Limits

This is bounded browser QA, not issuer-source reconciliation, all-widget certification, full market coverage, or proof that cached/visible ratios and prices are accurate. The ownership and issuer cards combine partial/stale/unavailable states; do not interpret displayed zeros, ratios, or quotes as independently validated facts. The five original webp captures are retained unchanged.
