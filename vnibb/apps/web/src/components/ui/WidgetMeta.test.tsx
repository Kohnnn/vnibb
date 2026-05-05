import { render, screen } from '@testing-library/react'

import { WidgetMeta } from '@/components/ui/WidgetMeta'

describe('WidgetMeta', () => {
  test('renders widget health badge when provided', () => {
    render(
      <WidgetMeta
        updatedAt="2026-04-17T10:00:00.000Z"
        health={{
          status: 'cached',
          label: 'Cached snapshot',
          detail: 'Showing the last successful refresh.',
        }}
        note="Quote + profile"
      />
    )

    expect(screen.getByText('Cached snapshot')).toBeInTheDocument()
    expect(screen.getByText('Quote + profile')).toBeInTheDocument()
  })
})
