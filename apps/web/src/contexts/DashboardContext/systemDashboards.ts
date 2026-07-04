// System Dashboard Factory Functions
// Provides factory functions for creating system dashboards used by tests and generators.
// These wrap the actual dashboard definitions from index.tsx and templates.ts.

import type { Dashboard } from '@/types/dashboard';
import { MAIN_TAB_TEMPLATES } from './templates';
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
    tabTemplates: TemplateWidget[][] = []
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
        tabs: tabTemplates.map((widgets, index) => ({
            id: `${id}-tab-${index}`,
            name: `Tab ${index + 1}`,
            order: index,
            widgets: createWidgetsFromTemplate(widgets, `${id}-tab-${index}`),
        })),
        syncGroups: [],
        createdAt: now,
        updatedAt: now,
    };
}

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
        'Technical analysis and charting workspace'
    );
}

export function createQuantSystemDashboard(): Dashboard {
    return makeSystemDashboard(
        QUANT_DASHBOARD_ID,
        'Quant',
        'Quantitative analysis and backtesting workspace'
    );
}

// Global Markets tab templates (mirrored from templates.ts)
const GLOBAL_MARKETS_TAB_TEMPLATE: TemplateWidget[] = [
    { type: 'tradingview_ticker_tape', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 4, minW: 12, minH: 3 } },
    { type: 'polymarket', syncGroupId: 1, config: {}, layout: { x: 0, y: 4, w: 8, h: 7, minW: 6, minH: 6 } },
    { type: 'tradingview_chart', syncGroupId: 1, config: { symbol: 'AMEX:SPY', useLinkedSymbol: false, allow_symbol_change: false }, layout: { x: 8, y: 4, w: 16, h: 12, minW: 10, minH: 8 } },
    { type: 'tradingview_market_overview', syncGroupId: 1, config: {}, layout: { x: 0, y: 16, w: 12, h: 8, minW: 8, minH: 6 } },
    { type: 'tradingview_market_data', syncGroupId: 1, config: {}, layout: { x: 12, y: 16, w: 12, h: 8, minW: 8, minH: 6 } },
    { type: 'world_news_map', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 120, freshnessHours: 72 }, layout: { x: 0, y: 24, w: 12, h: 9, minW: 8, minH: 6 } },
    { type: 'world_news_live_stream', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 30, freshnessHours: 24, pollSeconds: 60 }, layout: { x: 12, y: 24, w: 12, h: 9, minW: 6, minH: 6 } },
];

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
        tabs: GLOBAL_MARKETS_TAB_TEMPLATE.map((template, index) => ({
            id: `${GLOBAL_MARKETS_DASHBOARD_ID}-tab-${index}`,
            name: `Tab ${index + 1}`,
            order: index,
            widgets: createWidgetsFromTemplate([template], `${GLOBAL_MARKETS_DASHBOARD_ID}-tab-${index}`),
        })),
        syncGroups: [],
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Determines whether an existing Global Markets dashboard needs a layout refresh.
 * Returns true if the dashboard is missing 'polymarket' widgets.
 */
export function shouldRefreshGlobalMarketsLayout(dashboard: Dashboard): boolean {
    const hasPolymarket = dashboard.tabs.some((tab) =>
        tab.widgets.some((widget) => widget.type === 'polymarket')
    );
    return !hasPolymarket;
}
