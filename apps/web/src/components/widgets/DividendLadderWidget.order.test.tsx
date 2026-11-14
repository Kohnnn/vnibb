import type { UseQueryResult } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { useDividends } from '@/lib/queries'
import type { DividendRecord, DividendsResponse } from '@/lib/api'
import { DividendLadderWidget } from './DividendLadderWidget'

jest.mock('@/lib/queries', () => ({ useDividends: jest.fn() }))

const query = jest.mocked(useDividends)

function mockDividends(rows: DividendRecord[]) {
  query.mockReturnValue({
    data: { data: rows } as DividendsResponse,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
    dataUpdatedAt: 0,
  } as unknown as UseQueryResult<DividendsResponse, Error>)
}

const renderedDays = () =>
  screen.getAllByText(/^\d{4}-\d{2}-\d{2}$/).map((node) => node.textContent)

const renderedLabels = () =>
  screen.getAllByText(/^(Ex-Date|Record Date|Payment)$/).map((node) => node.textContent)

describe('DividendLadderWidget range and order (#259)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    // 17:00 ICT — the day is already underway, as in the reported case.
    jest.setSystemTime(new Date('2026-11-13T10:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('shows the newest historical actions under Latest events', () => {
    mockDividends(
      Array.from({ length: 12 }, (_, index) => ({
        payment_date: `2025-${String(index + 1).padStart(2, '0')}-01`,
      })),
    )

    render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" />)

    expect(screen.getByText('Latest events')).toBeInTheDocument()
    expect(renderedDays()).toEqual([
      '2025-12-01',
      '2025-11-01',
      '2025-10-01',
      '2025-09-01',
      '2025-08-01',
      '2025-07-01',
      '2025-06-01',
      '2025-05-01',
    ])
  })

  it("keeps today's date-only action in Upcoming, nearest day first", () => {
    mockDividends([{ payment_date: '2026-11-13' }, { payment_date: '2026-11-14' }])

    render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" />)

    expect(screen.getByText('Upcoming events')).toBeInTheDocument()
    expect(renderedDays()).toEqual(['2026-11-13', '2026-11-14'])
  })

  it('orders mixed past and future actions and keeps ex/record/payment distinct', () => {
    mockDividends([
      { ex_date: '2026-10-01', record_date: '2026-12-01', payment_date: '2026-12-20' },
      { ex_date: '2026-11-20', payment_date: '2026-12-01' },
    ])

    render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" />)

    expect(renderedDays()).toEqual(['2026-11-20', '2026-12-01', '2026-12-01', '2026-12-20'])
    expect(renderedLabels()).toEqual(['Ex-Date', 'Record Date', 'Payment', 'Payment'])
  })

  it('rolls the label and rows over at ICT midnight without a reload', () => {
    // 23:30 ICT on the 13th: the same day is still upcoming.
    jest.setSystemTime(new Date('2026-11-13T16:30:00Z'))
    mockDividends([{ payment_date: '2026-11-13' }])

    render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" />)

    expect(screen.getByText('Upcoming events')).toBeInTheDocument()
    expect(renderedDays()).toEqual(['2026-11-13'])

    // 00:01 ICT on the 14th: that row is history and the label must agree.
    jest.setSystemTime(new Date('2026-11-13T17:01:00Z'))
    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('Latest events')).toBeInTheDocument()
    expect(screen.queryByText('Upcoming events')).not.toBeInTheDocument()
    expect(renderedDays()).toEqual(['2026-11-13'])
  })

  it('drops malformed source dates rather than rendering them', () => {
    mockDividends([
      { ex_date: 'not-a-date' },
      { record_date: '2026-02-30' },
      { payment_date: '2026-12-01' },
    ])

    render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" />)

    expect(renderedDays()).toEqual(['2026-12-01'])
  })

  it('does not promote a valid future date carrying an impossible clock', () => {
    // #259 review H3: 2026-12-01T99:99:99 has a good date part but no sane
    // time, so it must not appear as Upcoming; the valid future row must.
    mockDividends([
      { ex_date: '2026-12-01T99:99:99' },
      { record_date: '2026-12-01T10:30:60' },
      { payment_date: '2026-12-05' },
    ])

    render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" />)

    expect(screen.getByText('Upcoming events')).toBeInTheDocument()
    expect(renderedDays()).toEqual(['2026-12-05'])
  })
})
