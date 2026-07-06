import { render } from '@testing-library/react';

import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
    it('renders an SVG with a polyline when given >= 2 points', () => {
        const { container } = render(<Sparkline values={[0.1, 0.4, 0.7, 0.5]} />);
        const polyline = container.querySelector('polyline');
        expect(polyline).not.toBeNull();
    });

    it('renders a dashed fallback when there is only one point', () => {
        const { container } = render(<Sparkline values={[0.5]} />);
        const line = container.querySelector('line');
        expect(line).not.toBeNull();
        expect(line?.getAttribute('stroke-dasharray')).toBeTruthy();
    });
});