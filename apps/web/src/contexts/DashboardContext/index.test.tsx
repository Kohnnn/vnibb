import { render, screen, waitFor } from '@testing-library/react';
import type { Dashboard, SystemDashboardTemplateListResponse } from '@/types/dashboard';
import {
  DashboardProvider,
  useDashboard,
} from './index';
import {
  CURRENT_MIGRATION_VERSION,
  CURRENT_STORAGE_VERSION,
  FOLDERS_KEY,
  MIGRATION_VERSION_KEY,
  STORAGE_KEY,
  STORAGE_VERSION_KEY,
} from './constants';
import { getPublishedSystemDashboardTemplates } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  getPublishedSystemDashboardTemplates: jest.fn(),
}));

jest.mock('@/lib/useDashboardSync', () => ({
  useDashboardSync: jest.fn(),
  useLoadFromBackend: jest.fn(),
}));

const customDashboard: Dashboard = {
  id: 'custom-restored-dashboard',
  name: 'Restored custom dashboard',
  order: 10,
  isDefault: false,
  isEditable: true,
  isDeletable: true,
  showGroupLabels: true,
  tabs: [],
  syncGroups: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

function DashboardStateProbe() {
  const { state } = useDashboard();

  return <output data-testid="dashboards">{JSON.stringify(state.dashboards)}</output>;
}

function renderProvider() {
  render(
    <DashboardProvider>
      <DashboardStateProbe />
    </DashboardProvider>,
  );
}

function storedDashboards(): Dashboard[] {
  return JSON.parse(screen.getByTestId('dashboards').textContent ?? '[]') as Dashboard[];
}

describe('DashboardProvider published templates', () => {
  const mockGetPublishedSystemDashboardTemplates = jest.mocked(getPublishedSystemDashboardTemplates);

  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
    window.localStorage.clear();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([customDashboard]));
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([]));
    window.localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
    window.localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['an empty response', () => mockGetPublishedSystemDashboardTemplates.mockResolvedValue({ count: 0, data: [] })],
    ['a rejected request', () => mockGetPublishedSystemDashboardTemplates.mockRejectedValue(new Error('unavailable'))],
  ])('keeps a restored custom dashboard after %s', async (_scenario, mockResponse) => {
    mockResponse();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderProvider();

    await waitFor(() => expect(mockGetPublishedSystemDashboardTemplates).toHaveBeenCalledTimes(1));

    expect(storedDashboards()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: customDashboard.id, name: customDashboard.name }),
    ]));

    warnSpy.mockRestore();
  });

  it('applies a published system template without replacing a restored custom dashboard', async () => {
    const publishedTemplate: Dashboard = {
      ...customDashboard,
      id: 'default-fundamental',
      name: 'Published Fundamental',
      isEditable: false,
      tabs: [{ id: 'published-tab', name: 'Published Overview', order: 0, widgets: [] }],
    };
    const response: SystemDashboardTemplateListResponse = {
      count: 1,
      data: [{
        dashboard_key: 'fundamental',
        status: 'published',
        version: 1,
        dashboard: publishedTemplate,
        updated_at: '2026-07-14T00:00:00.000Z',
      }],
    };
    mockGetPublishedSystemDashboardTemplates.mockResolvedValue(response);

    renderProvider();

    await waitFor(() => expect(storedDashboards().find((dashboard) => dashboard.id === 'default-fundamental')).toEqual(
      expect.objectContaining({ tabs: publishedTemplate.tabs }),
    ));

    expect(storedDashboards()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: customDashboard.id, name: customDashboard.name }),
    ]));
  });
});
