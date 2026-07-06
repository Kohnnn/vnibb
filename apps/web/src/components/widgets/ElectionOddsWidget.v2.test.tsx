import { render } from '@testing-library/react';

import { ElectionOddsWidget } from './ElectionOddsWidget';

const originalFetch = global.fetch;

beforeEach(() => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe('ElectionOddsWidget (v2)', () => {
    it('renders loading state on first paint', () => {
        const { getByText } = render(<ElectionOddsWidget />);
        expect(getByText(/Loading election odds/)).toBeInTheDocument();
    });
});