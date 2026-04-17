# Next Phases Execution Plan

Date: 2026-04-17

## Scope

This plan turns the selected next-priority ideas into an execution order for VNIBB.

Selected priorities:

1. finish adjustment-aware analytics end-to-end
2. improve VniAgent settings and the VniAgent tab/sidebar experience, without new artifact work
3. expand USD/FX beyond financial widgets
4. add data-quality and empty-state intelligence
5. improve dashboard intelligence
6. add benchmark-relative and downside risk upgrades
7. deepen discovery surfaces
8. finish Global Markets / TradingView consistency

## Architecture Guardrail

- Appwrite remains the intended full VNIBB market-data corpus.
- Supabase/Postgres is the constrained write-side bridge during quota pressure, not the permanent replacement for the full corpus.
- VniAgent stays VNIBB database-first.
- This phase set does not include new artifact creation work.

## Phase 0: Data Ownership Hardening

Goal:

- make the Appwrite-primary / Supabase-write-bridge model explicit across docs, settings copy, and AI/runtime surfaces

Deliverables:

- clean up docs that incorrectly imply Supabase/Postgres permanently replaced Appwrite as the full primary data store
- reinforce `VNIBB database` wording in AI and product settings
- add an architecture reference that explains the temporary quota bridge cleanly

Key areas:

- `docs/APPWRITE_PRIMARY_SUPABASE_WRITE_BRIDGE.md`
- `docs/DEPLOYMENT_AND_OPERATIONS.md`
- `docs/VNIBB_MCP_DEPLOYMENT.md`
- `apps/web/src/components/settings/SettingsModal.tsx`
- `apps/web/src/components/ui/AICopilot.tsx`

## Phase 1: Adjustment-Aware Analytics

Goal:

- make adjusted-price behavior consistent across quant and risk outputs, not only chart history

Deliverables:

- propagate `adjustment_mode` deeper into quant/stat endpoints
- add event markers for dividends, splits, and issuance where quality is reliable
- expose raw vs adjusted mode consistently in chart-facing widgets

Primary targets:

- `apps/api/vnibb/api/v1/equity.py`
- `apps/api/vnibb/api/v1/quant.py`
- risk and quant widgets consuming historical series

## Phase 2: VniAgent Settings And UX

Goal:

- make VniAgent simpler, more legible, and more workspace-native without adding artifact work yet

Deliverables:

- cleaner settings grouping: basics, data, advanced
- clearer active runtime display: model, source mode, and context
- saved sessions / recent threads / pinned prompts
- better answer-first default layout in the main sidebar
- stronger symbol/tab/widget context chips

Primary targets:

- `apps/web/src/lib/aiSettings.ts`
- `apps/web/src/components/settings/SettingsModal.tsx`
- `apps/web/src/components/ui/AICopilot.tsx`
- `apps/web/src/components/widgets/AIAnalysisWidget.tsx`
- `apps/web/src/components/widgets/AICopilotWidget.tsx`

Out of scope for this phase:

- new chart/table/report artifacts
- broader autonomous write actions

## Phase 3: USD / FX Expansion

Goal:

- extend the current yearly USD/VND conversion model beyond statement widgets

Deliverables:

- quote-widget currency coverage where semantically valid
- comparison-surface currency coverage
- selective market-surface currency support
- AI/export/report currency consistency

Guardrails:

- keep yearly override precedence unchanged
- avoid forced conversion for point/index-native widgets that should remain in points

## Phase 4: Data-Quality And Empty-State Intelligence

Goal:

- replace generic empty states with meaningful, trust-building explanations

Deliverables:

- widget health badges
- explicit `why no data` explanations
- source/fallback notes
- last-good snapshot display where applicable
- symbol/widget coverage map for ops and QA

Primary targets:

- `WidgetMeta`
- `WidgetEmpty`
- backend response metadata for stale/fallback/source state

## Phase 5: Dashboard Intelligence

Goal:

- help users build stronger dashboards instead of only exposing a raw grid

Deliverables:

- too-short widget warnings from the size contract
- duplicate-widget suggestions
- dead-tab detection
- dense vs analyst layout recommendations
- one-click `clone system tab into workspace` flows

Primary targets:

- `apps/web/src/lib/dashboardLayout.ts`
- `apps/web/src/components/widgets/WidgetWrapper.tsx`
- dashboard shell and widget library flows

## Phase 6: Risk Model Upgrade

Goal:

- move from mostly absolute risk widgets toward benchmark-relative and downside-aware risk analysis

Deliverables:

- benchmark-relative drawdown
- rolling beta
- tracking error
- downside deviation panels
- VaR / CVaR
- sector-relative attribution where cleanly supported

Primary targets:

- `apps/api/vnibb/api/v1/quant.py`
- `apps/web/src/components/widgets/RiskDashboardWidget.tsx`
- `apps/web/src/components/widgets/QuantSummaryWidget.tsx`

## Phase 7: Discovery Surfaces

Goal:

- improve idea generation and scanning, not just single-symbol deep dives

Priority candidates:

- `market_sentiment`
- `listing_browser` v2
- `ttm_snapshot`
- `growth_bridge`
- `ownership_rating_summary`
- richer derivatives widgets

Suggested order:

1. market sentiment
2. listing browser v2
3. growth bridge

## Phase 8: Global Markets Consistency

Goal:

- make TradingView-native widgets feel consistent, predictable, and easier to configure

Deliverables:

- stronger preset editors for Market Overview and Market Data
- per-widget capability hints from docs inside settings
- macro dashboard presets by use case: FX, rates, equities, crypto
- tighter alignment between typed settings and final runtime payloads

Primary targets:

- `apps/web/src/lib/tradingViewWidgets.ts`
- `apps/web/src/components/modals/WidgetSettingsModal.tsx`
- `docs/TRADINGVIEW_SETTINGS_ARCHITECTURE.md`

## Keep In Roadmap, Not Now

- broader AI artifact work
- richer autonomous AI mutation flows
- deeper derivatives expansion before discovery foundations improve
- architectural churn that pretends Supabase should replace the full Appwrite corpus

## Validation Rhythm

Minimum validation after each phase:

- frontend build
- relevant frontend unit tests
- targeted backend pytest for touched endpoints/services
- one manual runtime smoke pass on the deployed dashboard or local equivalent
