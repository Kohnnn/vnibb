'use client';

import { useMemo } from 'react';

import { useDashboard } from '@/contexts/DashboardContext';

export function useDashboardWidget(widgetId: string) {
  const { state, activeDashboard, activeTab } = useDashboard();

  return useMemo(() => {
    for (const dashboard of state.dashboards) {
      for (const tab of dashboard.tabs) {
        const widget = tab.widgets.find((item) => item.id === widgetId);
        if (widget) {
          return {
            dashboardId: dashboard.id,
            tabId: tab.id,
            widget,
          };
        }
      }
    }

    if (activeDashboard && activeTab) {
      const widget = activeTab.widgets.find((item) => item.id === widgetId) || null;
      if (widget) {
        return {
          dashboardId: activeDashboard.id,
          tabId: activeTab.id,
          widget,
        };
      }
    }

    return null;
  }, [activeDashboard, activeTab, state.dashboards, widgetId]);
}
