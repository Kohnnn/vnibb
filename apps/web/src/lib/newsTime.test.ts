import {
  newsItemObservation,
  newsObservationProvenance,
  normalizeNewsItemTimestamp,
  normalizeNewsTimestamp,
} from './newsTime'

describe('newsTime', () => {
  it('normalizes unix seconds and milliseconds to ISO strings', () => {
    expect(normalizeNewsTimestamp(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
    expect(normalizeNewsTimestamp(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('chooses known timestamp aliases from news items', () => {
    expect(normalizeNewsItemTimestamp({ published_date: '2026-05-15T09:30:00Z' })).toBe('2026-05-15T09:30:00.000Z')
    expect(normalizeNewsItemTimestamp({ created_at: '1700000000' })).toBe('2023-11-14T22:13:20.000Z')
  })

  it('normalizes VNEXPRESS 12-hour day-first timestamps', () => {
    expect(normalizeNewsTimestamp('28/05/2026 5:05:00 pm')).toBe(new Date(2026, 4, 28, 17, 5, 0).toISOString())
    expect(normalizeNewsTimestamp('28/05/2026 12:05:00 am')).toBe(new Date(2026, 4, 28, 0, 5, 0).toISOString())
  })

  it('returns null for missing timestamps', () => {
    expect(normalizeNewsItemTimestamp({ title: 'No date' })).toBeNull()
  })

  it('ignores crawl/ingest aliases when reading a source observation', () => {
    expect(newsItemObservation({ created_at: '2026-05-01T09:00:00Z', timestamp: 1_700_000_000 })).toBeNull()
    expect(newsItemObservation({ published_date: '2026-05-01T09:00:00Z' })).toBe('2026-05-01T09:00:00.000Z')
  })

  describe('newsObservationProvenance', () => {
    it('keeps an old article old when it is re-fetched now', () => {
      const receiptAt = '2026-10-08T12:00:00Z'
      const result = newsObservationProvenance(
        [{ published_at: '2026-05-01T09:00:00Z' }],
        { receiptAt },
      )
      expect(result.lastDataDate).toBe('2026-05-01T09:00:00.000Z')
      expect(result.coverage).toBeUndefined()
      expect(result.warning).toBeUndefined()
    })

    it('reports unknown, not fresh, when no displayed row carries a date', () => {
      const result = newsObservationProvenance([{ title: 'No date' }, { created_at: '2026-10-08T11:59:00Z' }])
      expect(result.lastDataDate).toBeNull()
      expect(result.coverage).toBeUndefined()
      expect(result.warning).toContain('2 of 2')
    })

    it('marks mixed dated/undated rows partial and names the undated count', () => {
      const result = newsObservationProvenance([
        { published_at: '2026-05-01T09:00:00Z' },
        { title: 'No date' },
      ])
      expect(result.lastDataDate).toBe('2026-05-01T09:00:00.000Z')
      expect(result.coverage).toBe('partial')
      expect(result.warning).toContain('1 of 2')
    })

    it('rejects a timestamp dated after retrieval as not a source observation', () => {
      const result = newsObservationProvenance(
        [{ published_at: '2026-10-08T12:00:05Z' }],
        { receiptAt: '2026-10-08T12:00:00Z' },
      )
      expect(result.lastDataDate).toBeNull()
    })
  })
})
