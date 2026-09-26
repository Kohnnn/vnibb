import { dashboardReducer } from './reducer';
import type { DashboardState } from '@/types/dashboard';

it('keeps authored widget geometry unchanged when runtime configuration updates include layout hints', () => {
    const state: DashboardState = {
        folders: [], activeDashboardId: 'personal', activeTabId: 'tab', dashboards: [{
            id: 'personal', name: 'Personal', isDefault: false, order: 0, showGroupLabels: true,
            createdAt: '2026-01-01', updatedAt: '2026-01-01', syncGroups: [], tabs: [{
                id: 'tab', name: 'Tab', order: 0, widgets: [
                    { id: 'one', type: 'notes', tabId: 'tab', config: {}, layout: { i: 'one', x: 0, y: 4, w: 8, h: 9 } },
                    { id: 'two', type: 'notes', tabId: 'tab', config: {}, layout: { i: 'two', x: 10, y: 20, w: 8, h: 9 } },
                ],
            }],
        }],
    };
    const next = dashboardReducer(state, { type: 'UPDATE_WIDGET_RUNTIME', payload: {
        dashboardId: 'personal', tabId: 'tab', widgetId: 'one',
        updates: { config: { loaded: true }, layout: { i: 'one', x: 0, y: 0, w: 8, h: 2 } },
    } });
    expect(next.dashboards[0].tabs[0].widgets.map((widget) => widget.layout)).toEqual(state.dashboards[0].tabs[0].widgets.map((widget) => widget.layout));
    expect(next.dashboards[0].tabs[0].widgets[0].config).toEqual({ loaded: true });
    expect(next.dashboards[0].updatedAt).toBe(state.dashboards[0].updatedAt);
});
