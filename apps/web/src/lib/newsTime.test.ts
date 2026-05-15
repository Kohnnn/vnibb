import { normalizeNewsItemTimestamp, normalizeNewsTimestamp } from './newsTime'

describe('newsTime', () => {
  it('normalizes unix seconds and milliseconds to ISO strings', () => {
    expect(normalizeNewsTimestamp(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
    expect(normalizeNewsTimestamp(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('chooses known timestamp aliases from news items', () => {
    expect(normalizeNewsItemTimestamp({ published_date: '2026-05-15T09:30:00Z' })).toBe('2026-05-15T09:30:00.000Z')
    expect(normalizeNewsItemTimestamp({ created_at: '1700000000' })).toBe('2023-11-14T22:13:20.000Z')
  })

  it('returns null for missing timestamps', () => {
    expect(normalizeNewsItemTimestamp({ title: 'No date' })).toBeNull()
  })
})
