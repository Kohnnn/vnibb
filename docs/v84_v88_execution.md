# Sprint V84-V88 Execution Notes

Date: 2026-02-27

## V84 - Zeabur 502 Triage Hardening

Implemented backend startup hardening in `apps/api/vnibb/api/main.py`:

- Added guarded startup timeouts:
  - `STARTUP_DB_CHECK_TIMEOUT_SECONDS`
  - `STARTUP_VNSTOCK_REG_TIMEOUT_SECONDS`
  - `STARTUP_WS_TIMEOUT_SECONDS`
- Added startup kill-switches:
  - `SKIP_SCHEDULER_STARTUP=true`
  - `SKIP_WEBSOCKET_STARTUP=true`
- Switched API router mount to lazy import with health-only fallback when router import fails.

## V85 - Production Data Sync Automation

Added orchestration script: `apps/api/scripts/v85_production_sync.py`

Capabilities:

- Safely runs:
  - `v67_universal_resync.py`
  - `v68_screener_enrich.py`
- Requires safety token for live writes: `--confirm RUN_PRODUCTION_SYNC`
- Refuses local/SQLite DB targets via `DATABASE_URL` validation.
- Runs V88 verification gates after sync automatically.

Examples:

```bash
# Dry run
python apps/api/scripts/v85_production_sync.py --dry-run

# Run V67+V68 on production config and verify
python apps/api/scripts/v85_production_sync.py --confirm RUN_PRODUCTION_SYNC

# Verification only (no sync)
python apps/api/scripts/v85_production_sync.py --verify-only
```

## V86 - New Quant Widgets

Added widgets:

- `apps/web/src/components/widgets/VolumeDeltaWidget.tsx`
- `apps/web/src/components/widgets/AmihudIlliquidityWidget.tsx`
- `apps/web/src/components/widgets/SeasonalityHeatmapWidget.tsx`

Integrated across dashboard system:

- Registry/layout/name/description: `apps/web/src/components/widgets/WidgetRegistry.ts`
- Widget type union: `apps/web/src/types/dashboard.ts`
- Widget library definitions: `apps/web/src/data/widgetDefinitions.ts`
- Technical template tab: `apps/web/src/contexts/DashboardContext.tsx`
- Widget preview mapping: `apps/web/src/components/widgets/WidgetPreview.tsx`

## V87 - Light Mode + Status Polish

Updated light-mode-safe input/select surfaces in:

- `apps/web/src/components/widgets/NewsFeedWidget.tsx`

Softened connection status UX in:

- `apps/web/src/components/ui/ConnectionStatus.tsx`

Offline state now presents a subdued `Status: Degraded` treatment instead of a bright red warning block.

## V88 - OpenBB Verification Matrix

Validation gates are automated in `v85_production_sync.py`:

1. Financial statements populated for VNM, VCB, FPT, HPG.
2. Screener tracked field non-null ratio above 50%.
3. Profile `market_cap` presence for VNM.
4. Near-real-time quote endpoint sanity check (`/equity/VNM/quote`).

Notes:

- Financial API paths were hardened for provider-level `BaseException` escapes in:
  - `apps/api/vnibb/services/financial_service.py`
  - `apps/api/vnibb/api/v1/equity.py`
- Profile market cap now falls back to quote data when DB latest price is unavailable.
