'use client'

import { render, screen, waitFor } from '@testing-library/react'

import { UnitProvider, useUnit } from '@/contexts/UnitContext'

const mockGetPublicUnitRuntimeConfig = jest.fn()

jest.mock('@/lib/api', () => ({
  getPublicUnitRuntimeConfig: (...args: unknown[]) => mockGetPublicUnitRuntimeConfig(...args),
}))

function Snapshot() {
  const {
    config,
    globalUsdVndDefaultRate,
    adminUsdVndRatesByYear,
    localUsdVndRatesByYear,
  } = useUnit()

  return (
    <pre data-testid="snapshot">
      {JSON.stringify({
        config,
        globalUsdVndDefaultRate,
        adminUsdVndRatesByYear,
        localUsdVndRatesByYear,
      })}
    </pre>
  )
}

describe('UnitContext', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    window.localStorage.clear()
    mockGetPublicUnitRuntimeConfig.mockReset()
    global.fetch = jest.fn() as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  test('merges admin yearly defaults under browser-local overrides', async () => {
    window.localStorage.setItem(
      'vnibb_unit_config',
      JSON.stringify({
        display: 'USD',
        usdVndRatesByYear: {
          '2024': 24000,
        },
      })
    )

    mockGetPublicUnitRuntimeConfig.mockResolvedValue({
      usd_vnd_default_rate: 25000,
      usd_vnd_rates_by_year: {
        '2024': 24500,
        '2025': 24800,
      },
      updated_at: '2026-04-16T12:00:00+00:00',
    })

    render(
      <UnitProvider>
        <Snapshot />
      </UnitProvider>
    )

    await waitFor(() => {
      expect(mockGetPublicUnitRuntimeConfig).toHaveBeenCalled()
      const snapshot = JSON.parse(screen.getByTestId('snapshot').textContent || '{}')
      expect(snapshot.globalUsdVndDefaultRate).toBe(25000)
      expect(snapshot.adminUsdVndRatesByYear).toEqual({ '2024': 24500, '2025': 24800 })
      expect(snapshot.localUsdVndRatesByYear).toEqual({ '2024': 24000 })
      expect(snapshot.config.usdVndRatesByYear).toEqual({
        '2024': 24000,
        '2025': 24800,
      })
    })
  })
})
