import { render, screen } from '@testing-library/react';
import { Sparkline } from './Sparkline';

// The tooltip is the only place a sparkline states a number, so its colour and
// sign must come from the change itself, never from the raw delta sign.
let tooltipValue = 0;
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    Tooltip: ({ content }: { content: React.ReactElement }) => {
      const Component = content.type as React.ComponentType<{
        active: boolean;
        payload: Array<{ value: number }>;
      }>;
      return <Component active payload={[{ value: tooltipValue }]} />;
    },
  };
});

function renderAt(point: number, data: number[]) {
  tooltipValue = point;
  return render(<Sparkline data={data} />);
}

describe('Sparkline trend tooltip', () => {
  it('signs a recovery from a negative base with the direction of the change', () => {
    renderAt(-50, [-100, -50]);
    // Absolute denominator: +50 of |-100| is +50.00%, not "-50.00%".
    const line = screen.getByText((_, el) => el?.textContent === '+50 (+50.00%)');
    expect(line).toBeInTheDocument();
    expect(line).toHaveClass('price-up');
  });

  it('signs a decline as a loss', () => {
    renderAt(50, [100, 50]);
    const line = screen.getByText((_, el) => el?.textContent === '-50 (-50.00%)');
    expect(line).toBeInTheDocument();
    expect(line).toHaveClass('price-down');
  });

  it('treats an unchanged point as flat, not a gain', () => {
    renderAt(50, [50, 50]);
    const line = screen.getByText((_, el) => el?.textContent === '0 (0.00%)');
    expect(line).toBeInTheDocument();
    expect(line).toHaveClass('price-flat');
  });
  it('shows an unavailable percentage for a zero start without inventing zero growth', () => {
    renderAt(1, [0, 1]);
    const line = screen.getByText((_, el) => el?.textContent === '+1 (n/a)');
    expect(line).toBeInTheDocument();
    expect(line).toHaveClass('price-up');
  })
});
