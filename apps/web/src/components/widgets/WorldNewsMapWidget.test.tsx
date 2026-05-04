import { render, screen } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'

import { WorldNewsLiveStreamWidget } from '@/components/widgets/WorldNewsLiveStreamWidget'
import { WorldNewsMapWidget } from '@/components/widgets/WorldNewsMapWidget'
import { WorldNewsSourcesWidget } from '@/components/widgets/WorldNewsSourcesWidget'

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

const article = {
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
}

describe('WorldNewsMapWidget', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: {
        buckets: [
          {
            id: 'vn',
            label: 'Vietnam',
            region: 'Vietnam',
            country_code: 'VN',
            country_name: 'Vietnam',
            latitude: 16.0544,
            longitude: 108.2022,
            article_count: 1,
            source_count: 1,
            failed_feed_count: 0,
            top_category: 'markets',
            top_sources: ['CafeF Markets'],
            latest_headline: 'VN-Index extends gains',
            latest_published_at: '2026-05-01T09:00:00Z',
            latest_articles: [article],
          },
        ],
        total_articles: 1,
        source_count: 1,
        feed_count: 1,
        failed_feed_count: 0,
        fetched_at: '2026-05-01T09:01:00Z',
        region: 'vietnam',
        category: 'markets',
        language: null,
        freshness_hours: 72,
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)
  })

  test('renders source geography and latest article links', () => {
    render(<WorldNewsMapWidget id="world-news-map" />)

    expect(screen.getAllByText('Vietnam').length).toBeGreaterThan(0)
    expect(screen.getByText('CafeF Markets')).toBeInTheDocument()
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

describe('WorldNewsLiveStreamWidget', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: {
        articles: [article],
        total: 1,
        fetched_at: '2026-05-01T09:01:00Z',
        source_count: 1,
        feed_count: 1,
        failed_feed_count: 0,
        region: 'vietnam',
        category: 'markets',
        language: null,
        source: null,
        freshness_hours: 24,
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)
  })

  test('renders latest headline with source and feed links', () => {
    render(<WorldNewsLiveStreamWidget id="world-news-live" />)

    expect(screen.getByText('Latest Signal')).toBeInTheDocument()
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

describe('WorldNewsSourcesWidget', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: {
        sources: [
          {
            id: 'cafef_markets',
            name: 'CafeF Markets',
            domain: 'cafef.vn',
            region: 'vietnam',
            category: 'markets',
            language: 'vi',
            tier: 1,
            homepage_url: 'https://cafef.vn/thi-truong-chung-khoan.chn',
            feed_urls: ['https://cafef.vn/thi-truong-chung-khoan.rss'],
            country_code: 'VN',
            country_name: 'Vietnam',
            latitude: 21.0285,
            longitude: 105.8542,
            map_region: 'Vietnam',
          },
        ],
        total: 1,
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)
  })

  test('renders source registry links and geography', () => {
    render(<WorldNewsSourcesWidget id="world-news-sources" />)

    expect(screen.getByText('CafeF Markets')).toBeInTheDocument()
    expect(screen.getByText('cafef.vn')).toBeInTheDocument()
    expect(screen.getAllByText('Vietnam').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Source/i })).toHaveAttribute(
      'href',
      'https://cafef.vn/thi-truong-chung-khoan.chn'
    )
    expect(screen.getByRole('link', { name: /Feed 1/i })).toHaveAttribute(
      'href',
      'https://cafef.vn/thi-truong-chung-khoan.rss'
    )
  })
})
