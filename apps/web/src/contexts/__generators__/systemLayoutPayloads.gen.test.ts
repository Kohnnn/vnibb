/**
 * Parity-safe generator for system dashboard publish payloads.
 *
 * This is NOT a behavioural test. It reuses the real built-in dashboard
 * factories in `DashboardContext.tsx` as the single source of truth and emits
 * JSON payloads ready for `PUT /api/v1/admin/system-layouts/{dashboard_key}`,
 * so the production DB-published templates exactly match the frontend fallback
 * (no hand-transcription drift across ~19 tabs).
 *
 * It only writes files when GENERATE_SYSTEM_LAYOUTS=1 so the normal CI Jest run
 * (`ci:gate`) treats it as a passing no-op.
 *
 * Usage (from apps/web):
 *   GENERATE_SYSTEM_LAYOUTS=1 OUT_DIR=../../.tmp/system-layouts \
 *     pnpm --filter frontend test -- --runTestsByPath \
 *     src/contexts/__generators__/systemLayoutPayloads.gen.test.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import {
    createMainSystemDashboard,
    createTechnicalSystemDashboard,
    createQuantSystemDashboard,
    createGlobalMarketsDashboard,
} from '@/contexts/DashboardContext';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import type { Dashboard } from '@/types/dashboard';

type SerializedDashboard = ReturnType<typeof serializeForPublish>;

// Mirror of DashboardClient.serializeSystemDashboardForPublish, with
// deterministic widget ids so published payloads diff cleanly across runs.
function serializeForPublish(dashboard: Dashboard) {
    return {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        globalMarketsSymbol: dashboard.globalMarketsSymbol,
        folderId: dashboard.folderId,
        order: dashboard.order,
        isDefault: dashboard.isDefault,
        isEditable: false,
        isDeletable: false,
        showGroupLabels: dashboard.showGroupLabels,
        tabs: dashboard.tabs.map((tab) => ({
            id: tab.id,
            name: tab.name,
            order: tab.order,
            widgets: tab.widgets.map((widget, index) => {
                const defaults = getWidgetDefaultLayout(widget.type);
                const widgetId = `${tab.id}-w${index}`;
                const cleanConfig = Object.fromEntries(
                    Object.entries(widget.config || {}).filter(([, value]) => value !== undefined),
                );
                return {
                    id: widgetId,
                    type: widget.type,
                    tabId: tab.id,
                    syncGroupId: widget.syncGroupId,
                    config: cleanConfig,
                    layout: {
                        i: widgetId,
                        x: Number.isFinite(widget.layout.x) ? widget.layout.x : 0,
                        y: Number.isFinite(widget.layout.y) ? widget.layout.y : 0,
                        w: Number.isFinite(widget.layout.w) ? widget.layout.w : defaults.w,
                        h: Number.isFinite(widget.layout.h) ? widget.layout.h : defaults.h,
                        minW: Number.isFinite(widget.layout.minW) ? widget.layout.minW : defaults.minW,
                        minH: Number.isFinite(widget.layout.minH) ? widget.layout.minH : defaults.minH,
                    },
                };
            }),
        })),
        syncGroups: dashboard.syncGroups.map((group) => ({
            id: group.id,
            name: group.name,
            color: group.color,
            currentSymbol: group.currentSymbol,
        })),
        createdAt: dashboard.createdAt,
        updatedAt: dashboard.updatedAt,
    };
}

describe('system layout publish payload generator', () => {
    it('emits publish-ready JSON for each system dashboard', () => {
        const dashboards: Record<string, Dashboard> = {
            'default-fundamental': createMainSystemDashboard(),
            'default-technical': createTechnicalSystemDashboard(),
            'default-quant': createQuantSystemDashboard(),
            'default-global-markets': createGlobalMarketsDashboard(),
        };

        // Sanity guards so a broken factory never ships a stripped layout.
        const quant = dashboards['default-quant'];
        const quantWidgetTypes = quant.tabs.flatMap((tab) => tab.widgets.map((w) => w.type));
        expect(quantWidgetTypes).toContain('backtest_lab');
        expect(quantWidgetTypes).toContain('sweep_matrix');

        if (process.env.GENERATE_SYSTEM_LAYOUTS !== '1') {
            return;
        }

        const outDir = resolve(process.cwd(), process.env.OUT_DIR || '../../.tmp/system-layouts');
        mkdirSync(outDir, { recursive: true });

        for (const [key, dashboard] of Object.entries(dashboards)) {
            const serialized: SerializedDashboard = serializeForPublish(dashboard);
            const body = {
                dashboard: serialized,
                notes: 'Balanced default Initial workspace + Quant Backtest widgets (backtest_lab, sweep_matrix).',
                publish: true,
            };
            const filePath = resolve(outDir, `${key}.json`);
            writeFileSync(filePath, JSON.stringify(body, null, 2), 'utf-8');
            console.log(`wrote ${filePath} (${dashboard.tabs.length} tabs)`);
        }
    });
});
