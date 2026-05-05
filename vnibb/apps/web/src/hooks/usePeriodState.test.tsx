import { fireEvent, render, screen } from '@testing-library/react'

import { usePeriodState } from '@/hooks/usePeriodState'

function PeriodStateHarness({ widgetId, sharedKey }: { widgetId: string; sharedKey?: string }) {
  const { period, setPeriod } = usePeriodState({
    widgetId,
    sharedKey,
    defaultPeriod: 'FY',
    validPeriods: ['FY', 'Q', 'TTM'],
  })

  return (
    <div>
      <div data-testid={`${widgetId}-period`}>{period}</div>
      <button onClick={() => setPeriod('Q')}>Set {widgetId} Q</button>
      <button onClick={() => setPeriod('TTM')}>Set {widgetId} TTM</button>
    </div>
  )
}

describe('usePeriodState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('shared keys keep financial widgets in sync', () => {
    render(
      <>
        <PeriodStateHarness widgetId="ratios" sharedKey="fundamental-core:VCI" />
        <PeriodStateHarness widgetId="income" sharedKey="fundamental-core:VCI" />
      </>
    )

    expect(screen.getByTestId('ratios-period')).toHaveTextContent('FY')
    expect(screen.getByTestId('income-period')).toHaveTextContent('FY')

    fireEvent.click(screen.getByRole('button', { name: 'Set ratios Q' }))

    expect(screen.getByTestId('ratios-period')).toHaveTextContent('Q')
    expect(screen.getByTestId('income-period')).toHaveTextContent('Q')
  })

  test('shared storage is restored before widget-local storage', () => {
    window.localStorage.setItem('vnibb_period_v3_shared_fundamental-core:VCI', 'TTM')
    window.localStorage.setItem('vnibb_period_v3_ratios', 'FY')

    render(<PeriodStateHarness widgetId="ratios" sharedKey="fundamental-core:VCI" />)

    expect(screen.getByTestId('ratios-period')).toHaveTextContent('TTM')
  })
})
