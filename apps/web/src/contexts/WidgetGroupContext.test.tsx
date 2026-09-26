import { act, renderHook } from '@testing-library/react';
import { useDashboard, type DashboardContextValue } from '@/contexts/DashboardContext';
import { WidgetGroupProvider, useWidgetGroups } from './WidgetGroupContext';
import { DEFAULT_GROUPS } from '@/types/widget';
import type { Dashboard } from '@/types/dashboard';

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
const mockUseDashboard = jest.mocked(useDashboard);

it('uses imported symbol groups without changing browser-wide group symbols', () => {
    localStorage.clear();
    localStorage.setItem('vnibb-global-symbol', 'VCB');
    localStorage.setItem('vnibb-widget-groups-v1', JSON.stringify({ ...DEFAULT_GROUPS, A: { ...DEFAULT_GROUPS.A, symbol: 'HPG' } }));
    const dashboard: Dashboard = {
        id: 'import-one', name: 'Imported', order: 0, isDefault: false, showGroupLabels: true,
        tabs: [], syncGroups: [], createdAt: '2026-01-01', updatedAt: '2026-01-01',
        widgetGroups: { ...DEFAULT_GROUPS, global: { ...DEFAULT_GROUPS.global, symbol: 'FPT' }, A: { ...DEFAULT_GROUPS.A, symbol: 'VNM' } },
    };
    const updateDashboardRuntime = jest.fn();
    mockUseDashboard.mockReturnValue({ activeDashboard: dashboard, updateDashboardRuntime } as unknown as DashboardContextValue);
    const { result, rerender } = renderHook(() => useWidgetGroups(), { wrapper: WidgetGroupProvider });
    expect(result.current.globalSymbol).toBe('FPT');
    expect(result.current.getSymbolForGroup('A')).toBe('VNM');
    expect(result.current.getSharedGroups().global.symbol).toBe('VCB');
    act(() => result.current.setGroupSymbol('A', 'SSI'));
    expect(updateDashboardRuntime).toHaveBeenLastCalledWith('import-one', {
        widgetGroups: { ...dashboard.widgetGroups, A: { ...dashboard.widgetGroups!.A, symbol: 'SSI' } },
    });
    expect(JSON.parse(localStorage.getItem('vnibb-widget-groups-v1')!).A.symbol).toBe('HPG');
    expect(localStorage.getItem('vnibb-global-symbol')).toBe('VCB');
    mockUseDashboard.mockReturnValue({ activeDashboard: null, updateDashboardRuntime } as unknown as DashboardContextValue);
    rerender();
    expect(result.current.globalSymbol).toBe('VCB');
    expect(result.current.getSymbolForGroup('A')).toBe('HPG');
});
