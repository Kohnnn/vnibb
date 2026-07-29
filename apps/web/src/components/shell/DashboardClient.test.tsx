import { render, screen } from '@testing-library/react';
import { DashboardSyncStatusMessage } from './DashboardClient';

describe('DashboardSyncStatusMessage', () => {
  it('labels local-only persistence as saved on this device', () => {
    render(<DashboardSyncStatusMessage enabled status="local" />);

    expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
    expect(screen.queryByText('Cloud sync failed. Check your connection and refresh to try again.')).not.toBeInTheDocument();
  });
});
