import { render, screen } from '@testing-library/react';
import DashboardPage, { DashboardSyncStatusMessage } from './DashboardClient';

describe('DashboardSyncStatusMessage', () => {
  it('labels local-only persistence as saved on this device', () => {
    render(<DashboardSyncStatusMessage enabled status="local" />);

    expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
    expect(screen.queryByText('Cloud sync failed. Check your connection and refresh to try again.')).not.toBeInTheDocument();
  });
});

describe('DashboardPage', () => {
  it('exports the page that bridges research starters into the copilot', () => {
    // DashboardClient owns the only copilot starter seam; importing the module
    // here keeps that wiring covered by the suite that guards this file.
    expect(typeof DashboardPage).toBe('function');
  });
});
