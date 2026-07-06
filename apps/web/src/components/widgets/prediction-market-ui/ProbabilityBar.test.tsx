import { render } from '@testing-library/react';

import { ProbabilityBar } from './ProbabilityBar';

describe('ProbabilityBar', () => {
    it('renders a meter with the correct aria-valuenow for value=0.45', () => {
        const { getByRole } = render(<ProbabilityBar value={0.45} />);
        const meter = getByRole('meter');
        expect(meter.getAttribute('aria-valuenow')).toBe(String(Math.round(0.45 * 100)));
    });

    it('renders a meter at full scale when value=1', () => {
        const { getByRole } = render(<ProbabilityBar value={1} showLabels />);
        const meter = getByRole('meter');
        expect(meter.getAttribute('aria-valuenow')).toBe('100');
    });

    it('renders the now/delta labels when showLabels and delta are provided', () => {
        const { getByText } = render(<ProbabilityBar value={0.6} delta={0.1} showLabels />);
        expect(getByText(/Now 60%/)).toBeInTheDocument();
        expect(getByText(/\+10.0pp/)).toBeInTheDocument();
    });
});