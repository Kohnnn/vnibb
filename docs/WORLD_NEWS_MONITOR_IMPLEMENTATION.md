# World News Monitor Implementation

Date: 2026-05-01

## Goal

Add a live multi-source world news monitor inspired by `koala73/worldmonitor`, while keeping VNIBB's existing `news_feed`, `market_news`, and `news_flow` widgets intact.

## Status

- Backend live RSS/Atom aggregation: implemented.
- Frontend widget: implemented.
- Widget library categorization: implemented under `Global Markets`, with news-oriented search terms.
- System dashboard templates: implemented in `Global Markets` and `News & Events` templates.
- Starter template catalog: implemented in `global-markets` and `news-watcher` templates.
- Tests: backend service, backend endpoint, and frontend widget render coverage added.
- Validation: see the latest run notes below.

## Backend

New service:

- `apps/api/vnibb/services/world_news_service.py`

New endpoints:

- `GET /api/v1/news/world`
- `GET /api/v1/news/world/sources`

The service fetches live RSS/Atom feeds, normalizes article fields, deduplicates by URL/title, classifies each article into a category, and returns source/homepage/feed/article links for auditability.

## Source Registry

The maintained source registry is static in `WORLD_NEWS_SOURCES` and intentionally explicit. Each source includes:

- source id
- source name
- domain
- region
- category
- language
- tier
- homepage URL
- RSS/Atom feed URLs

Current source coverage:

- `cafef_markets`: CafeF markets feed, Vietnam, Vietnamese, markets.
- `cafef_macro`: CafeF macro feed, Vietnam, Vietnamese, economy.
- `vietstock_markets`: Vietstock securities feed, Vietnam, Vietnamese, markets.
- `vietstock_economy`: Vietstock economy feed, Vietnam, Vietnamese, economy.
- `vnexpress_business`: VnExpress business feed, Vietnam, Vietnamese, business.
- `vnexpress_world`: VnExpress world feed, Vietnam, Vietnamese, geopolitics.
- `tuoitre_business`: Tuoi Tre business feed, Vietnam, Vietnamese, business.
- `vneconomy_markets`: VnEconomy markets feed, Vietnam, Vietnamese, markets.
- `baodautu_business`: Bao Dau Tu business feed, Vietnam, Vietnamese, business.
- `bbc_business`: BBC business feed, global, English, business.
- `bbc_world`: BBC world feed, global, English, geopolitics.
- `ap_business`: AP business feed, US, English, business.
- `ap_world`: AP world news feed, global, English, geopolitics.
- `cnbc_markets`: CNBC markets feed, US, English, markets.
- `guardian_business`: The Guardian business feed, Europe, English, business.
- `aljazeera_global`: Al Jazeera global feed, global, English, geopolitics.

## Frontend

New widget:

- `apps/web/src/components/widgets/WorldNewsMonitorWidget.tsx`

New API client types and functions:

- `WorldNewsArticle`
- `WorldNewsFeedResponse`
- `WorldNewsSourceInfo`
- `getWorldNews`
- `getWorldNewsSources`

The widget exposes:

- region filters: All, Vietnam, Global, US, Europe
- category filters: All Topics, Markets, Economy, Business, Geopolitics, Tech
- live article links
- source homepage links
- RSS/Atom feed links
- source/feed counts in widget meta

## Template Integration

Updated integration points:

- `apps/web/src/types/dashboard.ts`: added `world_news_monitor` to `WidgetType`.
- `apps/web/src/data/widgetDefinitions.ts`: added widget definition under `global_markets`.
- `apps/web/src/components/widgets/WidgetRegistry.ts`: added registry entry, default layout, name, and description.
- `apps/web/src/lib/dashboardLayout.ts`: added operative size contract.
- `apps/web/src/contexts/DashboardContext.tsx`: added to the Global Markets system dashboard and the Main News system tab.
- `apps/web/src/types/dashboard-templates.ts`: added to Global Markets and News Watcher starter templates.
- `apps/web/src/components/CommandPalette.tsx`: added an explicit command palette add action.

## Tests Added

- `apps/api/tests/test_api/test_world_news_service.py`
- `apps/api/tests/test_api/test_news_endpoint_api.py`
- `apps/web/src/components/widgets/WorldNewsMonitorWidget.test.tsx`

## Validation Notes

Run results on 2026-05-01:

- Passed: `python -m ruff check apps/api/vnibb/services/world_news_service.py apps/api/vnibb/api/v1/news.py apps/api/tests/test_api/test_world_news_service.py apps/api/tests/test_api/test_news_endpoint_api.py`
- Passed: `python -m pytest apps/api/tests/test_api/test_world_news_service.py apps/api/tests/test_api/test_news_endpoint_api.py -v`
- Passed: `pnpm --filter frontend test -- --runTestsByPath src/components/widgets/WorldNewsMonitorWidget.test.tsx`
- Passed: `pnpm --filter frontend exec tsc --noEmit`
- Passed: `pnpm --filter frontend lint`

Notes:

- Ruff reported the repository's existing deprecated top-level Ruff config warning in `apps/api/pyproject.toml`.
- The frontend widget test reported the expected local test warning for missing `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`, then passed using local defaults.
