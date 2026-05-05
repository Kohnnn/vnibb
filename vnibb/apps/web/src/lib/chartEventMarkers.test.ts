import { buildChartEventMarkers } from '@/lib/chartEventMarkers'

describe('buildChartEventMarkers', () => {
  test('maps dividend and split events onto the next available trading date', () => {
    const markers = buildChartEventMarkers(
      [
        {
          symbol: 'VNM',
          action_category: 'dividend',
          action_subtype: 'cash_dividend',
          ex_date: '2026-04-12',
        },
        {
          symbol: 'VNM',
          action_category: 'split',
          event_date: '2026-04-14',
        },
      ],
      [
        { time: '2026-04-11' },
        { time: '2026-04-13' },
        { time: '2026-04-14' },
      ],
    )

    expect(markers).toEqual([
      expect.objectContaining({ date: '2026-04-13', shortLabel: 'D', category: 'dividend' }),
      expect.objectContaining({ date: '2026-04-14', shortLabel: 'S', category: 'split' }),
    ])
  })

  test('deduplicates repeated events on the same aligned date and category', () => {
    const markers = buildChartEventMarkers(
      [
        {
          symbol: 'VNM',
          action_category: 'dividend',
          action_subtype: 'cash_dividend',
          ex_date: '2026-05-10',
        },
        {
          symbol: 'VNM',
          action_category: 'dividend',
          action_subtype: 'cash_dividend',
          effective_date: '2026-05-10',
        },
      ],
      [{ time: '2026-05-11' }],
    )

    expect(markers).toHaveLength(1)
    expect(markers[0]).toEqual(expect.objectContaining({ date: '2026-05-11', shortLabel: 'D' }))
  })
})
