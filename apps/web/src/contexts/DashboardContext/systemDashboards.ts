// System Dashboard Factory Functions
// Provides factory functions for creating system dashboards used by tests and generators.
// These wrap the actual dashboard definitions from index.tsx and templates.ts.

import type { Dashboard, DashboardTab } from '@/types/dashboard';
import { GLOBAL_MARKETS_TEMPLATE, MAIN_TAB_TEMPLATES } from './templates';
import {
    MAIN_DASHBOARD_ID,
    MAIN_DASHBOARD_NAME,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_NAME,
    INITIAL_FOLDER_ID,
} from './constants';
import { createWidgetsFromTemplate } from './templates';
import type { TemplateWidget } from './types';

const now = new Date().toISOString();

function makeSystemDashboard(
    id: string,
    name: string,
    description: string,
    tabs: DashboardTab[]
): Dashboard {
    return {
        id,
        name,
        description,
        globalMarketsSymbol: undefined,
        folderId: INITIAL_FOLDER_ID,
        order: 0,
        isDefault: true,
        isEditable: true,
        adminUnlocked: false,
        showGroupLabels: false,
        tabs,
        syncGroups: [],
        createdAt: now,
        updatedAt: now,
    };
}

// #110: the DashboardContext modularization dropped the tab specs for the
// Technical and Quant workspaces, so their factories emitted an empty tab list.
// Any profile without a published admin layout then rendered "no tabs
// available", and `?tab=` deep links into those workspaces resolved to nothing.
// Restore the canonical tab set. Ids follow the published catalogue pattern
// `tab-<dashboardId>-<suffix>`, so a remembered `lastActiveTabIdByDashboard`
// entry and a `?tab=` deep link resolve against the bundled fallback too; a
// published admin layout still overrides it on load.
type SystemTabSpec = { idSuffix: string; name: string; widgets: TemplateWidget[] };

function buildSystemTabs(dashboardId: string, specs: SystemTabSpec[]): DashboardTab[] {
    return specs.map((spec, index) => {
        const tabId = `tab-${dashboardId}-${spec.idSuffix}`;
        return {
            id: tabId,
            name: spec.name,
            order: index,
            widgets: createWidgetsFromTemplate(spec.widgets, tabId),
        };
    });
}

const MAIN_QUANT_TEMPLATE: TemplateWidget[] = [
    { type: 'risk_dashboard', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 12, h: 11, minW: 8, minH: 8 } },
    { type: 'volume_profile', syncGroupId: 1, config: {}, layout: { x: 12, y: 0, w: 12, h: 11, minW: 8, minH: 8 } },
    { type: 'momentum', syncGroupId: 1, config: {}, layout: { x: 0, y: 11, w: 8, h: 11, minW: 6, minH: 8 } },
    { type: 'drawdown_recovery', syncGroupId: 1, config: {}, layout: { x: 8, y: 11, w: 8, h: 11, minW: 6, minH: 8 } },
    { type: 'signal_summary', syncGroupId: 1, config: {}, layout: { x: 16, y: 11, w: 8, h: 11, minW: 6, minH: 8 } },
    { type: 'gap_analysis', syncGroupId: 1, config: {}, layout: { x: 0, y: 22, w: 8, h: 10, minW: 6, minH: 8 } },
    { type: 'volume_flow', syncGroupId: 1, config: {}, layout: { x: 8, y: 22, w: 8, h: 10, minW: 6, minH: 8 } },
    { type: 'gap_fill_stats', syncGroupId: 1, config: {}, layout: { x: 16, y: 22, w: 8, h: 10, minW: 6, minH: 8 } },
    { type: 'backtest_lab', syncGroupId: 1, config: {}, layout: { x: 0, y: 32, w: 8, h: 9, minW: 5, minH: 6 } },
    { type: 'sweep_matrix', syncGroupId: 1, config: {}, layout: { x: 8, y: 32, w: 8, h: 9, minW: 5, minH: 6 } },
];

const QUANT_COMPARISON_TEMPLATE: TemplateWidget[] = [
    { type: 'correlation_matrix', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 14, h: 12, minW: 10, minH: 9 } },
    { type: 'risk_dashboard', syncGroupId: 1, config: {}, layout: { x: 14, y: 0, w: 10, h: 12, minW: 8, minH: 9 } },
    { type: 'relative_rotation', syncGroupId: 1, config: {}, layout: { x: 0, y: 12, w: 12, h: 10, minW: 8, minH: 8 } },
    { type: 'rs_ranking', syncGroupId: 1, config: {}, layout: { x: 12, y: 12, w: 12, h: 10, minW: 8, minH: 8 } },
];

const QUANT_MARKET_TEMPLATE: TemplateWidget[] = [
    { type: 'market_overview', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'market_breadth', syncGroupId: 1, config: {}, layout: { x: 8, y: 0, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'top_movers', syncGroupId: 1, config: {}, layout: { x: 16, y: 0, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'money_flow_trend', syncGroupId: 1, config: {}, layout: { x: 0, y: 10, w: 14, h: 12, minW: 10, minH: 9 } },
    { type: 'industry_bubble', syncGroupId: 1, config: {}, layout: { x: 14, y: 10, w: 10, h: 12, minW: 8, minH: 9 } },
    { type: 'signal_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 22, w: 24, h: 8, minW: 12, minH: 6 } },
];

const MAIN_TECHNICAL_TEMPLATE: TemplateWidget[] = [
    { type: 'ichimoku', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 12, h: 14, minW: 10, minH: 10 } },
    { type: 'fibonacci', syncGroupId: 1, config: {}, layout: { x: 12, y: 0, w: 12, h: 12, minW: 10, minH: 9 } },
    { type: 'technical_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 14, w: 8, h: 10, minW: 6, minH: 8 } },
    { type: 'technical_snapshot', syncGroupId: 1, config: {}, layout: { x: 8, y: 14, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'atr_regime', syncGroupId: 1, config: {}, layout: { x: 16, y: 12, w: 8, h: 12, minW: 6, minH: 8 } },
    { type: 'macd_crossovers', syncGroupId: 1, config: {}, layout: { x: 0, y: 24, w: 8, h: 12, minW: 6, minH: 9 } },
    { type: 'bollinger_squeeze', syncGroupId: 1, config: {}, layout: { x: 8, y: 24, w: 8, h: 12, minW: 6, minH: 9 } },
    { type: 'rsi_seasonal', syncGroupId: 1, config: {}, layout: { x: 16, y: 24, w: 8, h: 12, minW: 6, minH: 9 } },
    // Intraday VWAP bands; surfaced empty-state messaging when market is closed
    // or no trade ticks (PR-3 polish). Was missing from this template entirely
    // so the FE polish never had a cell to render in.
    { type: 'vwap_bands', syncGroupId: 1, config: {}, layout: { x: 0, y: 36, w: 12, h: 11, minW: 8, minH: 8 } },
    // Footprint proxy bars derived from trade-tick match types.
    { type: 'footprint_proxy', syncGroupId: 1, config: {}, layout: { x: 12, y: 36, w: 12, h: 11, minW: 8, minH: 8 } },
];

const MAIN_TRADING_TEMPLATE: TemplateWidget[] = [
    { type: 'transaction_flow', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 12, h: 10, minW: 8, minH: 6 } },
    { type: 'orderbook', syncGroupId: 1, config: {}, layout: { x: 12, y: 0, w: 12, h: 10, minW: 8, minH: 6 } },
    { type: 'intraday_trades', syncGroupId: 1, config: {}, layout: { x: 0, y: 10, w: 12, h: 8, minW: 8, minH: 6 } },
    { type: 'block_trade', syncGroupId: 1, config: {}, layout: { x: 12, y: 10, w: 12, h: 8, minW: 8, minH: 6 } },
];

const MAIN_MARKET_TEMPLATE: TemplateWidget[] = [
    { type: 'market_overview', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 8, h: 10, minW: 6, minH: 6 } },
    { type: 'top_movers', syncGroupId: 1, config: {}, layout: { x: 8, y: 0, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'market_breadth', syncGroupId: 1, config: {}, layout: { x: 16, y: 0, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'market_heatmap', syncGroupId: 1, config: {}, layout: { x: 0, y: 10, w: 12, h: 16, minW: 10, minH: 12 } },
    { type: 'sector_board', syncGroupId: 1, config: {}, layout: { x: 12, y: 10, w: 12, h: 16, minW: 10, minH: 12 } },
    { type: 'money_flow_trend', syncGroupId: 1, config: {}, layout: { x: 0, y: 26, w: 12, h: 12, minW: 10, minH: 9 } },
    { type: 'industry_bubble', syncGroupId: 1, config: {}, layout: { x: 12, y: 26, w: 12, h: 12, minW: 8, minH: 9 } },
];

const INITIAL_TECHNICAL_TEMPLATE: TemplateWidget[] = [
    { type: 'price_chart', syncGroupId: 1, config: { timeframe: '1Y', chartType: 'candle' }, layout: { x: 0, y: 0, w: 24, h: 10, minW: 12, minH: 8 } },
    { type: 'signal_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 10, w: 24, h: 8, minW: 12, minH: 6 } },
    { type: 'volume_analysis', syncGroupId: 1, config: {}, layout: { x: 0, y: 18, w: 8, h: 6, minW: 6, minH: 5 } },
    { type: 'momentum', syncGroupId: 1, config: {}, layout: { x: 8, y: 18, w: 8, h: 6, minW: 6, minH: 5 } },
    { type: 'atr_regime', syncGroupId: 1, config: {}, layout: { x: 16, y: 18, w: 8, h: 6, minW: 6, minH: 5 } },
];

const INITIAL_QUANT_TEMPLATE: TemplateWidget[] = [
    { type: 'quant_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 8, minW: 10, minH: 6 } },
    { type: 'seasonality_heatmap', syncGroupId: 1, config: {}, layout: { x: 0, y: 10, w: 14, h: 13, minW: 10, minH: 10 } },
    { type: 'sortino_monthly', syncGroupId: 1, config: {}, layout: { x: 14, y: 10, w: 10, h: 13, minW: 8, minH: 10 } },
    { type: 'drawdown_recovery', syncGroupId: 1, config: {}, layout: { x: 0, y: 23, w: 8, h: 10, minW: 6, minH: 8 } },
    { type: 'gap_analysis', syncGroupId: 1, config: {}, layout: { x: 8, y: 23, w: 8, h: 10, minW: 6, minH: 8 } },
    { type: 'correlation_matrix', syncGroupId: 1, config: {}, layout: { x: 16, y: 23, w: 8, h: 12, minW: 7, minH: 9 } },
    { type: 'garch_volatility', syncGroupId: 1, config: {}, layout: { x: 0, y: 35, w: 8, h: 8, minW: 5, minH: 5 } },
    { type: 'signal_summary', syncGroupId: 1, config: {}, layout: { x: 8, y: 35, w: 16, h: 8, minW: 12, minH: 6 } },
];

const TECHNICAL_TAB_SPECS: SystemTabSpec[] = [
    { idSuffix: 'technical', name: 'Technical', widgets: MAIN_TECHNICAL_TEMPLATE },
    { idSuffix: 'overview', name: 'Overview', widgets: INITIAL_TECHNICAL_TEMPLATE },
    { idSuffix: 'trading', name: 'Trading', widgets: MAIN_TRADING_TEMPLATE },
    { idSuffix: 'market', name: 'Market', widgets: MAIN_MARKET_TEMPLATE },
];

const QUANT_TAB_SPECS: SystemTabSpec[] = [
    { idSuffix: 'quant', name: 'Quant', widgets: MAIN_QUANT_TEMPLATE },
    { idSuffix: 'overview', name: 'Overview', widgets: INITIAL_QUANT_TEMPLATE },
    { idSuffix: 'comparison', name: 'Comparison', widgets: QUANT_COMPARISON_TEMPLATE },
    { idSuffix: 'market', name: 'Market', widgets: QUANT_MARKET_TEMPLATE },
];

export function createMainSystemDashboard(): Dashboard {
    return {
        id: MAIN_DASHBOARD_ID,
        name: MAIN_DASHBOARD_NAME,
        description: 'Comprehensive fundamental analysis workspace',
        globalMarketsSymbol: undefined,
        folderId: INITIAL_FOLDER_ID,
        order: 0,
        isDefault: true,
        isEditable: true,
        adminUnlocked: false,
        showGroupLabels: false,
        tabs: MAIN_TAB_TEMPLATES.map((tabTemplate, index) => ({
            id: `${MAIN_DASHBOARD_ID}-tab-${index}`,
            name: tabTemplate.name,
            order: index,
            widgets: createWidgetsFromTemplate(tabTemplate.widgets, `${MAIN_DASHBOARD_ID}-tab-${index}`),
        })),
        syncGroups: [],
        createdAt: now,
        updatedAt: now,
    };
}

export function createTechnicalSystemDashboard(): Dashboard {
    return makeSystemDashboard(
        TECHNICAL_DASHBOARD_ID,
        'Technical',
        'Technical analysis and charting workspace',
        buildSystemTabs(TECHNICAL_DASHBOARD_ID, TECHNICAL_TAB_SPECS),
    );
}

export function createQuantSystemDashboard(): Dashboard {
    return makeSystemDashboard(
        QUANT_DASHBOARD_ID,
        'Quant',
        'Quantitative analysis and backtesting workspace',
        buildSystemTabs(QUANT_DASHBOARD_ID, QUANT_TAB_SPECS),
    );
}

// Phase 7.7 — Prediction Markets tab template.
//
// Six tiles wired into the new prediction-market family (Polymarket, Kalshi,
// ElectionOdds, MacroCalibration, PredictionMovers). Mirrored from the
// `publish_prediction_markets_layout.py` admin script so the bundled
// fallback and the admin-published layout stay aligned.
//
// Widget types below MUST also be present in:
//   * `apps/web/src/types/dashboard.ts` (`WidgetType` union)
//   * `apps/web/src/components/widgets/WidgetRegistry.ts` (`registerWidget`)
//   * `apps/web/src/data/widgetDefinitions.ts` (UI catalogue)
// or the frontend will log "widget not found" and render a placeholder.
export const PREDICTION_MARKETS_DASHBOARD_ID = 'dash-prediction-markets';
export const PREDICTION_MARKETS_DASHBOARD_NAME = 'Prediction Markets';

const PREDICTION_MARKETS_TAB_TEMPLATE: TemplateWidget[] = [
    {
        type: 'polymarket',
        syncGroupId: 1,
        config: { source: 'polymarket', category: 'economic', limit: 12 },
        layout: { x: 0, y: 0, w: 8, h: 7, minW: 6, minH: 5 },
    },
    {
        type: 'polymarket',
        syncGroupId: 1,
        config: { source: 'polymarket', category: 'sports', limit: 12 },
        layout: { x: 8, y: 0, w: 8, h: 7, minW: 6, minH: 5 },
    },
    {
        type: 'kalshi',
        syncGroupId: 1,
        config: { source: 'kalshi', limit: 12 },
        layout: { x: 0, y: 7, w: 8, h: 7, minW: 6, minH: 5 },
    },
    {
        type: 'election_odds',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 7, w: 8, h: 8, minW: 6, minH: 6 },
    },
    {
        type: 'macro_calibration',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 14, w: 16, h: 8, minW: 8, minH: 6 },
    },
    {
        type: 'prediction_movers',
        syncGroupId: 1,
        config: { windowHours: 24, limit: 12 },
        layout: { x: 16, y: 0, w: 8, h: 14, minW: 6, minH: 9 },
    },
];

export function createPredictionMarketsDashboard(): Dashboard {
    return {
        id: PREDICTION_MARKETS_DASHBOARD_ID,
        name: PREDICTION_MARKETS_DASHBOARD_NAME,
        description: 'Polymarket, Kalshi, election odds, macro calibration, and probability movers.',
        globalMarketsSymbol: undefined,
        folderId: INITIAL_FOLDER_ID,
        order: 1,
        isDefault: false,
        isEditable: true,
        adminUnlocked: false,
        showGroupLabels: false,
        tabs: PREDICTION_MARKETS_TAB_TEMPLATE.map((template, index) => ({
            id: `${PREDICTION_MARKETS_DASHBOARD_ID}-tab-${index}`,
            name: PREDICTION_MARKETS_DASHBOARD_NAME,
            order: index,
            widgets: createWidgetsFromTemplate([template], `${PREDICTION_MARKETS_DASHBOARD_ID}-tab-${index}`),
        })),
        syncGroups: [],
        createdAt: now,
        updatedAt: now,
    };
}

export function createGlobalMarketsDashboard(): Dashboard {
    return {
        id: GLOBAL_MARKETS_DASHBOARD_ID,
        name: GLOBAL_MARKETS_DASHBOARD_NAME,
        description: 'Global markets overview workspace',
        globalMarketsSymbol: undefined,
        folderId: INITIAL_FOLDER_ID,
        order: 0,
        isDefault: true,
        isEditable: true,
        adminUnlocked: false,
        showGroupLabels: false,
        tabs: [{
            id: `${GLOBAL_MARKETS_DASHBOARD_ID}-tab-0`,
            name: GLOBAL_MARKETS_DASHBOARD_NAME,
            order: 0,
            widgets: createWidgetsFromTemplate(
                GLOBAL_MARKETS_TEMPLATE,
                `${GLOBAL_MARKETS_DASHBOARD_ID}-tab-0`,
            ),
        }],
        syncGroups: [],
        createdAt: now,
        updatedAt: now,
    };
}
