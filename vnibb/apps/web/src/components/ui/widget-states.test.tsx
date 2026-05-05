import { fireEvent, render, screen } from '@testing-library/react'

import {
  CompactError,
  WidgetEmpty,
  WidgetError,
  WidgetLoading,
} from '@/components/ui/widget-states'

describe('widget states', () => {
  test('WidgetLoading renders custom message', () => {
    render(<WidgetLoading message="Loading quotes..." />)
    expect(screen.getByText('Loading quotes...')).toBeInTheDocument()
  })

  test('WidgetError shows network-friendly title and retry action', () => {
    const onRetry = jest.fn()
    render(<WidgetError error={new Error('NetworkError: fetch failed')} onRetry={onRetry} />)

    expect(screen.getByText('Connection Failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('WidgetError maps mixed-content errors to secure guidance', () => {
    render(<WidgetError error={new Error('Mixed content blocked by browser')} />)
    expect(screen.getByText('Mixed Content Blocked')).toBeInTheDocument()
    expect(screen.getByText(/API URL uses HTTPS/i)).toBeInTheDocument()
  })

  test('WidgetEmpty runs action callback', () => {
    const onAction = jest.fn()
    render(
      <WidgetEmpty
        message="No rows"
        action={{
          label: 'Refresh',
          onClick: onAction,
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  test('WidgetEmpty renders health label and detail when provided', () => {
    render(
      <WidgetEmpty
        message="No flow data"
        health={{
          status: 'coverage_gap',
          label: 'Sparse coverage',
          detail: 'Provider only covers selected high-liquidity names.',
        }}
      />
    )

    expect(screen.getByText('Sparse coverage')).toBeInTheDocument()
    expect(screen.getByText('Provider only covers selected high-liquidity names.')).toBeInTheDocument()
  })

  test('CompactError supports retry icon button', () => {
    const onRetry = jest.fn()
    render(<CompactError message="Oops" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
