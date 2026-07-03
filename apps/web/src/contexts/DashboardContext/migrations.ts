// Migration functions for Dashboard Context - extracted from DashboardContext.tsx

import type { Dashboard, DashboardTab, WidgetInstance } from '@/types/dashboard';
import { normalizeWidgetType } from '@/data/widgetDefinitions';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { autoFitGridItems } from '@/lib/dashboardLayout';

import {
    LEGACY_DASHBOARD_NAME_RE,
    LEGACY_SIDEBAR_DASHBOARD_RE,
    LEGACY_MANAGE_TAB_NAME_RE,
    LEGACY_STALE_TAB_RE,
} from './constants';

import {
    TAB_WIDGET_TEMPLATES,
    TAB_NAME_TO_TEMPLATE_KEY,
    createWidgetsFromTemplate,
} from './templates';

// Count Dashboard Widgets (used by migrateLegacySidebarDashboards)
const countDashboardWidgets = (dashboard: Dashboard): number => {
    return dashboard.tabs.reduce((total, tab) => total + tab.widgets.length, 0);
};

// ============================================================================
// Widget Fingerprint
// ============================================================================

const widgetFingerprint = (type: string, config: unknown): string => {
    const normalizedConfig = config && typeof config === 'object' ? config : {};
    return `${type}:${JSON.stringify(normalizedConfig)}`;
};

// ============================================================================
// Migrate Empty Tabs
// ============================================================================

export const migrateEmptyTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map(dashboard => ({
        ...dashboard,
        tabs: dashboard.tabs.map(tab => {
            if (tab.widgets.length > 0) return tab;

            const templateName = TAB_NAME_TO_TEMPLATE_KEY[tab.name.toLowerCase()];
            if (!templateName) return tab;

            const template = TAB_WIDGET_TEMPLATES[templateName];
            if (!template) return tab;

            const widgets = createWidgetsFromTemplate(template, tab.id);
            return { ...tab, widgets };
        }),
    }));
};

// ============================================================================
// Migrate Legacy Widget Types
// ============================================================================

export const migrateLegacyWidgetTypes = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        let dashboardChanged = false;

        const tabs = dashboard.tabs.map((tab) => {
            const seenCanonicalWidgets = new Set<string>();
            let changed = false;

            const widgets = tab.widgets.flatMap((widget) => {
                const normalizedType = normalizeWidgetType(widget.type);
                if (!normalizedType) {
                    changed = true;
                    return [];
                }

                const fingerprint = widgetFingerprint(normalizedType, widget.config);
                const isLegacyAlias = normalizedType !== widget.type;

                if (isLegacyAlias && seenCanonicalWidgets.has(fingerprint)) {
                    changed = true;
                    return [];
                }

                seenCanonicalWidgets.add(fingerprint);

                if (!isLegacyAlias) {
                    return [widget];
                }

                changed = true;
                return [{
                    ...widget,
                    type: normalizedType,
                }];
            });

            if (!changed) return tab;

            dashboardChanged = true;
            return { ...tab, widgets };
        });

        if (!dashboardChanged) return dashboard;

        return {
            ...dashboard,
            tabs,
            updatedAt: new Date().toISOString(),
        };
    });
};

// ============================================================================
// Migrate Legacy Widget Layout Bounds
// ============================================================================

export const migrateLegacyWidgetLayoutBounds = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        let dashboardChanged = false;

        const tabs = dashboard.tabs.map((tab) => {
            let tabChanged = false;

            const widgets = tab.widgets.map((widget) => {
                const defaults = getWidgetDefaultLayout(widget.type);
                const nextMinW = Math.min(widget.layout.minW ?? defaults.minW, defaults.minW);
                const nextMinH = Math.min(widget.layout.minH ?? defaults.minH, defaults.minH);

                if (
                    widget.layout.minW === nextMinW
                    && widget.layout.minH === nextMinH
                    && widget.layout.maxW === undefined
                    && widget.layout.maxH === undefined
                ) {
                    return widget;
                }

                tabChanged = true;
                dashboardChanged = true;

                return {
                    ...widget,
                    layout: {
                        ...widget.layout,
                        minW: nextMinW,
                        minH: nextMinH,
                        maxW: undefined,
                        maxH: undefined,
                    },
                };
            });

            if (!tabChanged) return tab;
            return { ...tab, widgets };
        });

        if (!dashboardChanged) return dashboard;

        return {
            ...dashboard,
            tabs,
            updatedAt: new Date().toISOString(),
        };
    });
};

// ============================================================================
// Migrate Legacy Dashboard Names
// ============================================================================

export const migrateLegacyDashboardNames = (dashboards: Dashboard[]): Dashboard[] => {
    const usedNames = new Set(
        dashboards
            .filter((dashboard) => !LEGACY_DASHBOARD_NAME_RE.test(dashboard.name.trim()))
            .map((dashboard) => dashboard.name.trim().toLowerCase())
    );

    let dashboardNumber = 1;
    const nextDashboardName = () => {
        while (usedNames.has(`dashboard ${dashboardNumber}`)) {
            dashboardNumber += 1;
        }
        const candidate = `Dashboard ${dashboardNumber}`;
        usedNames.add(candidate.toLowerCase());
        dashboardNumber += 1;
        return candidate;
    };

    return dashboards.map((dashboard) => {
        if (!LEGACY_DASHBOARD_NAME_RE.test(dashboard.name.trim())) {
            usedNames.add(dashboard.name.trim().toLowerCase());
            return dashboard;
        }

        return {
            ...dashboard,
            name: nextDashboardName(),
            updatedAt: new Date().toISOString(),
        };
    });
};

// ============================================================================
// Migrate Legacy Chart Widgets
// ============================================================================

export const migrateLegacyChartWidgets = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => ({
        ...dashboard,
        tabs: dashboard.tabs.map((tab) => ({
            ...tab,
            widgets: tab.widgets.map((widget) => {
                const widgetType = widget.type as string;
                const configuredSymbol = typeof widget.config?.symbol === 'string' ? widget.config.symbol : '';
                const isGlobalContext =
                    dashboard.name.trim().toLowerCase() === 'global markets' ||
                    tab.name.trim().toLowerCase() === 'global markets';

                if (widgetType === 'price_chart' && (configuredSymbol.includes(':') || isGlobalContext)) {
                    return {
                        ...widget,
                        type: 'tradingview_chart',
                    };
                }

                return widget;
            }),
        })),
    }));
};

// ============================================================================
// Migrate Legacy Sidebar Dashboards
// ============================================================================

export const migrateLegacySidebarDashboards = (dashboards: Dashboard[]): Dashboard[] => {
    const filteredDashboards = dashboards.filter((dashboard) => {
        if (!LEGACY_SIDEBAR_DASHBOARD_RE.test(dashboard.name.trim())) {
            return true;
        }

        if (dashboards.length <= 1) {
            return true;
        }

        return countDashboardWidgets(dashboard) > 0;
    });

    if (filteredDashboards.length === 0) {
        return dashboards;
    }

    const usedNames = new Set(
        filteredDashboards
            .filter((dashboard) => !LEGACY_SIDEBAR_DASHBOARD_RE.test(dashboard.name.trim()))
            .map((dashboard) => dashboard.name.trim().toLowerCase())
    );

    let dashboardNumber = 1;
    const nextDashboardName = () => {
        while (usedNames.has(`dashboard ${dashboardNumber}`)) {
            dashboardNumber += 1;
        }
        const candidate = `Dashboard ${dashboardNumber}`;
        usedNames.add(candidate.toLowerCase());
        dashboardNumber += 1;
        return candidate;
    };

    return filteredDashboards.map((dashboard) => {
        if (!LEGACY_SIDEBAR_DASHBOARD_RE.test(dashboard.name.trim())) {
            return dashboard;
        }

        return {
            ...dashboard,
            name: nextDashboardName(),
            updatedAt: new Date().toISOString(),
        };
    });
};

// ============================================================================
// Migrate Manage Tabs
// ============================================================================

export const migrateManageTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        const filteredTabs = dashboard.tabs.filter((tab) => {
            if (!LEGACY_MANAGE_TAB_NAME_RE.test(tab.name.trim())) {
                return true;
            }
            return tab.widgets.length > 0;
        });

        if (filteredTabs.length === dashboard.tabs.length) {
            return dashboard;
        }

        return {
            ...dashboard,
            tabs: filteredTabs,
            updatedAt: new Date().toISOString(),
        };
    });
};

// ============================================================================
// Migrate Stale Tabs
// ============================================================================

export const migrateStaleTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        const filteredTabs = dashboard.tabs.filter((tab) => {
            if (!LEGACY_STALE_TAB_RE.test(tab.name.trim())) {
                return true;
            }
            return tab.widgets.length > 0;
        });

        if (filteredTabs.length === dashboard.tabs.length) {
            return dashboard;
        }

        return {
            ...dashboard,
            tabs: filteredTabs,
            updatedAt: new Date().toISOString(),
        };
    });
};
