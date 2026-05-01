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
            source_id: 'cafef_markets',
            source: 'CafeF Markets',
            source_domain: 'cafef.vn',
            source_url: 'https://cafef.vn/thi-truong-chung-khoan.chn',
            feed_url: 'https://cafef.vn/thi-truong-chung-khoan.rss',
            url: 'https://cafef.vn/story',
            published_at: '2026-05-01T09:00:00Z',
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
    expect(screen.getByText('cafef.vn')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /VN-Index extends gains/i })).toHaveAttribute(
      'href',
      'https://cafef.vn/story'
    )
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://cafef.vn/thi-truong-chung-khoan.chn'
    )
    expect(screen.getByRole('link', { name: /Feed/i })).toHaveAttribute(
      'href',
      'https://cafef.vn/thi-truong-chung-khoan.rss'
    )
  })
})
