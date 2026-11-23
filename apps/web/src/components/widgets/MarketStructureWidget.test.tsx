import { render, screen } from '@testing-library/react'

import { useHistoricalPrices } from '@/lib/queries'
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime'
import { MarketStructureWidget } from './MarketStructureWidget'

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(),
  useForeignTrading: () => ({}),
}))

jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))

function renderProfile(volumes: (number | null)[]) {
  jest.mocked(useHistoricalPrices).mockReturnValue({
    data: {
      data: volumes.map((volume, index) => ({
        symbol: 'FPT', time: `2026-10-0${index + 1}`, price_unit: 'VND',
        open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume,
      })),
      meta: { unit_status: 'confirmed_vnd' },
    },
  } as ReturnType<typeof useHistoricalPrices>)
  const onDataChange = jest.fn<void, [WidgetDataPayload]>()
  render(<MarketStructureWidget symbol="FPT" onDataChange={onDataChange} />)
  return getWidgetExportData(onDataChange.mock.lastCall?.[0])
}

test('withholds and does not export volume-derived levels when a returned session has unknown volume', () => {
  const data = renderProfile([100, null, 0])

  expect(screen.getByText(/Market structure unavailable: volume is unknown/)).toBeInTheDocument()
  expect(screen.queryByText('POC')).not.toBeInTheDocument()
  expect(data).toBeUndefined()
})

test('publishes volume-derived levels when the returned sample includes a measured zero', () => {
  const data = renderProfile([100, 0, 300])

  expect(screen.getByText('POC')).toBeInTheDocument()
  expect(data).toMatchObject({ poc: 102.4375, keyLevels: [
    { price: 102.4375, volume: 300, volumePct: 75 },
    { price: 100.5625, volume: 100, volumePct: 25 },
  ] })
})
