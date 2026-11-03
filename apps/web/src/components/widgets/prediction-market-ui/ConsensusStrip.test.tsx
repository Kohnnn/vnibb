import { render, screen } from '@testing-library/react';

import { ConsensusStrip } from './ConsensusStrip';

describe('ConsensusStrip', () => {
    it('shows missing prices without rendering them as zero-probability bars', () => {
        render(
            <ConsensusStrip
                rows={[
                    { source: 'Polymarket', yesPrice: null, url: null },
                    { source: 'Kalshi', yesPrice: 0, url: null },
                ]}
            />,
        );

        expect(screen.getByText('No data')).toBeInTheDocument();
        expect(screen.getByText('n/a')).toBeInTheDocument();
        expect(screen.getAllByRole('meter')).toHaveLength(1);
        expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
    });
});
