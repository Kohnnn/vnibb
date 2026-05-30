import { render, screen } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'

import { WorldNewsMonitorWidget } from '@/components/widgets/WorldNewsMonitorWidget'

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}))

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: any }) => <div>{children}</div>,
}))

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}))

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}))

const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>

describe('WorldNewsMonitorWidget', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: {
        articles: [
          {
            id: 'cafef-1',
            title: 'VN-Index extends gains',
            summary: 'Bank stocks led the market higher.',
            source_id: 'vnexpress_business',
            source: 'VNExpress Business',
            source_domain: 'vnexpress.net',
            source_url: 'https://vnexpress.net/kinh-doanh',
            feed_url: 'https://vnexpress.net/rss/kinh-doanh.rss',
            url: 'https://vnexpress.net/story',
            published_at: '28/05/2026 5:05:00 pm',
            region: 'vietnam',
            category: 'markets',
            language: 'vi',
            tags: ['markets', 'vietnam'],
            relevance_score: 0.91,
            live: true,
          },
        ],
        total: 1,
        fetched_at: '2026-05-01T09:01:00Z',
        source_count: 1,
        feed_count: 1,
        failed_feed_count: 0,
        region: 'vietnam',
        category: 'markets',
        language: null,
        source: null,
        freshness_hours: 72,
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)
  })

  test('renders article, source, and live feed links', () => {
    render(<WorldNewsMonitorWidget id="world-news" />)

    expect(screen.getByText('VN-Index extends gains')).toBeInTheDocument()
    expect(screen.getByText('vnexpress.net')).toBeInTheDocument()
    expect(screen.queryByText('Date unavailable')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /VN-Index extends gains/i })).toHaveAttribute(
      'href',
      'https://vnexpress.net/story'
    )
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://vnexpress.net/kinh-doanh'
    )
    expect(screen.getByRole('link', { name: /Feed/i })).toHaveAttribute(
      'href',
      'https://vnexpress.net/rss/kinh-doanh.rss'
    )
  })
})
