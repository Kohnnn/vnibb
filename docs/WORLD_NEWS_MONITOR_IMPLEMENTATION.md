# World News Monitor Implementation

Date: 2026-05-02

## Goal

Add a live multi-source world news monitor suite inspired by `koala73/worldmonitor`, while keeping VNIBB's existing `news_feed`, `market_news`, and `news_flow` widgets intact.

## Status

- Backend live RSS/Atom aggregation: implemented.
- Backend source-geography map aggregation: implemented.
- Frontend widgets: implemented for monitor, map, live stream, and source registry.
- Widget library categorization: implemented under `Global Markets`, with news-oriented search terms.
- System dashboard templates: implemented in `Global Markets` and `News & Events` templates.
- Starter template catalog: implemented in `global-markets`, `world-monitor`, and `news-watcher` templates.
- Tests: backend service, backend endpoint, and frontend widget render coverage added.
- Validation: see the latest run notes below.

## Backend

New service:

- `apps/api/vnibb/services/world_news_service.py`

New endpoints:

- `GET /api/v1/news/world`
- `GET /api/v1/news/world/map`
- `GET /api/v1/news/world/sources`

The service fetches live RSS/Atom feeds, normalizes article fields, deduplicates by URL/title, classifies each article into a category, and returns source/homepage/feed/article links for auditability. The map endpoint reuses the same live feed path and groups fresh articles by source geography.

Endpoint responsibilities:

- `GET /api/v1/news/world`: live article feed with source, region, category, language, source homepage, feed URL, and original article URL.
- `GET /api/v1/news/world/map`: source-geography buckets with country coordinates, article counts, top category, top sources, latest headline, latest publish time, and latest articles.
- `GET /api/v1/news/world/sources`: maintained source registry with homepage/feed URLs and geography metadata.

Supported filters:

- `region=vietnam|asia|us|europe|global`
- `category=markets|economy|business|geopolitics|technology`
- `language=vi|en`
- `source=<source id or domain>` on `/news/world`
- `limit` and `freshness_hours` on feed/map endpoints

Core response contracts:

- `WorldNewsArticle`: `id`, `title`, `summary`, `source_id`, `source`, `source_domain`, `source_url`, `feed_url`, `url`, `published_at`, `region`, `category`, `language`, `tags`, `relevance_score`, `live`.
- `WorldNewsMapBucket`: `id`, `label`, `region`, `country_code`, `country_name`, `latitude`, `longitude`, `article_count`, `source_count`, `failed_feed_count`, `top_category`, `top_sources`, `latest_headline`, `latest_published_at`, `latest_articles`.
- `WorldNewsSourceInfo`: `id`, `name`, `domain`, `region`, `category`, `language`, `tier`, `homepage_url`, `feed_urls`, `country_code`, `country_name`, `latitude`, `longitude`, `map_region`.

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
- source country/coordinates/map region

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

New widgets:

- `apps/web/src/components/widgets/WorldNewsMonitorWidget.tsx`
- `apps/web/src/components/widgets/WorldNewsMapWidget.tsx`
- `apps/web/src/components/widgets/WorldNewsLiveStreamWidget.tsx`
- `apps/web/src/components/widgets/WorldNewsSourcesWidget.tsx`

New API client types and functions:

- `WorldNewsArticle`
- `WorldNewsFeedResponse`
- `WorldNewsMapBucket`
- `WorldNewsMapResponse`
- `WorldNewsSourceInfo`
- `getWorldNews`
- `getWorldNewsMap`
- `getWorldNewsSources`

The widget suite exposes:

- region filters: All, Vietnam, Global, US, Europe
- category filters: All Topics, Markets, Economy, Business, Geopolitics, Tech
- live article links
- source homepage links
- RSS/Atom feed links
- source/feed counts in widget meta
- country/source/category aggregates in the map drilldown
- polling-based live-stream refresh state
- source registry auditing with homepage, feed, geography, tier, region, category, and language metadata

Widget responsibilities:

- `world_news_monitor`: full live headline list with article/source/feed links.
- `world_news_map`: map-first view of source geography, article density, top sources, top category, and latest articles.
- `world_news_live_stream`: compact polling headline stream for fresh market-risk monitoring.
- `world_news_sources`: source-audit registry for homepage/feed/geography/tier/category/language transparency.

## Template Integration

Updated integration points:

- `apps/web/src/types/dashboard.ts`: added `world_news_monitor`, `world_news_map`, `world_news_live_stream`, and `world_news_sources` to `WidgetType`.
- `apps/web/src/data/widgetDefinitions.ts`: added widget definitions under `global_markets`.
- `apps/web/src/components/widgets/WidgetRegistry.ts`: added registry entries, default layouts, names, and descriptions.
- `apps/web/src/lib/dashboardLayout.ts`: added operative size contracts.
- `apps/web/src/contexts/DashboardContext.tsx`: added the suite to the Global Markets system dashboard and the Main News system tab.
- `apps/web/src/types/dashboard-templates.ts`: added the suite to Global Markets, added a World Monitor starter template, and expanded News Watcher.
- `apps/web/src/components/widgets/WidgetPreview.tsx`: added world-news map/stream/source previews.
- `apps/web/src/components/CommandPalette.tsx`: added explicit monitor and suite add actions.

Final inclusion checklist:

- Backend service and response models are in `apps/api/vnibb/services/world_news_service.py`.
- Backend routes are in `apps/api/vnibb/api/v1/news.py`.
- Frontend API types/client functions are in `apps/web/src/lib/api.ts`.
- Widget components are in `apps/web/src/components/widgets/WorldNews*.tsx`.
- Widget IDs are registered in `apps/web/src/types/dashboard.ts`, `apps/web/src/components/widgets/WidgetRegistry.ts`, `apps/web/src/data/widgetDefinitions.ts`, and `apps/web/src/lib/dashboardLayout.ts`.
- Discovery surfaces are updated in `apps/web/src/components/widgets/WidgetPreview.tsx`, `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/contexts/DashboardContext.tsx`, and `apps/web/src/types/dashboard-templates.ts`.
- Maintainer docs are updated in `docs/API_REFERENCE.md`, `docs/WIDGET_CATALOG.md`, `docs/WIDGET_SYSTEM_REFERENCE.md`, and this run log.

## Tests Added

- `apps/api/tests/test_api/test_world_news_service.py`
- `apps/api/tests/test_api/test_news_endpoint_api.py`
- `apps/web/src/components/widgets/WorldNewsMonitorWidget.test.tsx`
- `apps/web/src/components/widgets/WorldNewsMapWidget.test.tsx` covers map, live stream, and sources widgets.

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

Run results on 2026-05-02:

- Passed: `python -m ruff check apps/api/vnibb/services/world_news_service.py apps/api/vnibb/api/v1/news.py apps/api/tests/test_api/test_world_news_service.py apps/api/tests/test_api/test_news_endpoint_api.py`
- Passed: `python -m pytest apps/api/tests/test_api/test_world_news_service.py apps/api/tests/test_api/test_news_endpoint_api.py -v`
- Passed: `pnpm --filter frontend test -- --runTestsByPath src/components/widgets/WorldNewsMonitorWidget.test.tsx src/components/widgets/WorldNewsMapWidget.test.tsx`
- Passed: `pnpm --filter frontend exec tsc --noEmit`
- Passed: `pnpm --filter frontend lint`

Run results after source-registry widget on 2026-05-02:

- Passed: `pnpm --filter frontend test -- --runTestsByPath src/components/widgets/WorldNewsMonitorWidget.test.tsx src/components/widgets/WorldNewsMapWidget.test.tsx`
- Passed: `pnpm --filter frontend exec tsc --noEmit`
- Passed: `pnpm --filter frontend lint`

Notes:

- Ruff still reports the repository's existing deprecated top-level Ruff config warning in `apps/api/pyproject.toml`.
- The frontend widget tests still report the expected local test warning for missing `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`, then pass using local defaults.
