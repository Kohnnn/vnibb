import { render, screen } from '@testing-library/react';

import { NewsCard } from './NewsCard';

const base = {
  id: 'row',
  title: 'Article',
  source: 'cafef',
  url: 'https://example.com/row',
  symbols: [],
  sentiment: 'neutral' as const,
};

test('dispatches association label by class, not by score or symbol count', () => {
  render(
    <>
      <NewsCard
        news={{
          ...base,
          id: 'sector',
          title: 'Giá thép xây dựng tăng trong quý này',
          matched_symbols: [],
          relevance_score: null,
          match_reason: 'sector_keyword',
          association_class: 'verified_sector',
        }}
      />
      <NewsCard
        news={{
          ...base,
          id: 'market',
          title: 'Market closes higher',
          matched_symbols: [],
          relevance_score: 0,
          match_reason: null,
          is_market_wide_fallback: true,
        }}
      />
      <NewsCard
        news={{
          ...base,
          id: 'direct',
          title: 'HPG công bố kết quả',
          matched_symbols: ['HPG'],
          relevance_score: 1,
          match_reason: 'exact_symbol_title',
          association_class: 'direct_company',
        }}
      />
      <NewsCard
        news={{
          ...base,
          id: 'unknown',
          title: 'No metadata',
          matched_symbols: [],
          relevance_score: null,
          match_reason: 'sector_keyword',
        }}
      />
    </>,
  );

  // The sector row has no score and no symbols: it must still be labelled.
  expect(screen.getByText('Industry overlap · no company evidence')).toBeInTheDocument();
  expect(screen.getByTitle(/Shared industry only/)).toBeInTheDocument();
  // General market is explicit, never inferred from a zero score.
  expect(screen.getByText('Market-wide fallback')).toBeInTheDocument();
  expect(screen.getByTitle(/Broad market article/)).toBeInTheDocument();
  // Only the direct row shows a rank.
  expect(screen.getByText(/exact symbol title · rank 100\/100/)).toBeInTheDocument();
  expect(screen.queryByText(/industry overlap[^ ]* · rank/)).not.toBeInTheDocument();
  // Missing class defaults to unverified, not to a sector claim.
  expect(screen.getByText('Association unverified')).toBeInTheDocument();
});

test('states article sentiment provenance without implying stock impact', () => {
  render(
    <>
      <NewsCard
        news={{ ...base, id: 'provider', title: 'HPG provider class', sentiment: 'positive', sentiment_source: 'provider' }}
      />
      <NewsCard
        news={{ ...base, id: 'heuristic', title: 'HPG local estimate', sentiment: 'bullish', sentiment_source: 'heuristic' }}
      />
      {/* A delivered label with no recorded origin stays unknown, not provider. */}
      <NewsCard news={{ ...base, id: 'unknown', title: 'HPG unknown origin', sentiment: 'neutral' }} />
    </>,
  );

  expect(screen.getByText('provider')).toBeInTheDocument();
  expect(screen.getByText('heuristic')).toBeInTheDocument();
  expect(screen.getByText('source unknown')).toBeInTheDocument();
  expect(screen.queryByText(/stock impact expected/i)).not.toBeInTheDocument();
  expect(
    screen.getByLabelText(/Article sentiment: Bullish \(heuristic\)\. Sentiment computed locally/),
  ).toBeInTheDocument();
});

test('renders no direction at all for an explicitly unavailable sentiment', () => {
  render(
    <NewsCard
      news={{ ...base, id: 'none', title: 'HPG undated sentiment', sentiment: 'neutral', sentiment_source: 'unavailable' }}
    />,
  );

  // "Neutral" here would be fabricated: nothing recorded this article's class.
  expect(screen.queryByText('Neutral')).not.toBeInTheDocument();
  expect(screen.getByText('Sentiment unavailable')).toBeInTheDocument();
  expect(screen.getByLabelText(/Article sentiment: Sentiment unavailable/)).toBeInTheDocument();
});
