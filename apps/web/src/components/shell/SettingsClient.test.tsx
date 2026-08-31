import { render, screen } from '@testing-library/react';
import SettingsClient from './SettingsClient';

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockSetPreferredVnstockSource = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@/contexts/DataSourcesContext', () => ({
  useDataSources: () => ({
    preferredVnstockSource: 'KBS',
    setPreferredVnstockSource: mockSetPreferredVnstockSource,
  }),
}));

jest.mock('@/lib/analytics', () => ({
  ANALYTICS_EVENTS: {
    settingsOpened: 'settings_opened',
    walkthroughRestartRequested: 'walkthrough_restart_requested',
    dataSourceChanged: 'data_source_changed',
  },
  captureAnalyticsEvent: jest.fn(),
}));

jest.mock('@/lib/userPreferences', () => ({
  resetDashboardWalkthroughPreference: jest.fn(),
}));

describe('SettingsClient', () => {
  it('shows only controls that persist immediately', () => {
    render(<SettingsClient />);

    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart Walkthrough' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /KBS/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dark Mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API Endpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });
});
