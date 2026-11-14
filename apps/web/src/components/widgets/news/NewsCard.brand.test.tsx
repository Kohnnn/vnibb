import { render, screen } from '@testing-library/react';

import { NewsCard, getSentimentBadgeTone } from './NewsCard';

/**
 * #200 family sweep, consumer-visible invariants for the news/record family.
 *
 * 1. Provider sentiment keeps a direction colour, but the card must also name it
 *    in words: colour alone is not an accessible signal (brand §13).
 * 2. A missing source publication date renders `n/a`, not a dash and not the
 *    fetch time (brand §22: unknown is not "now").
 */
const base = {
  id: 'n1',
  title: 'Vietcombank reports quarterly results',
  source: 'VnExpress',
  url: 'https://example.test/n1',
  symbols: [],
  sentiment: 'bearish' as const,
  published_at: null,
  published_date: null,
};

describe('news card brand contract', () => {
  it('names the sentiment class next to the coloured glyph', () => {
    render(<NewsCard news={{ ...base }} />);
    expect(screen.getByText('Bearish')).toBeInTheDocument();
  });

  it('renders n/a for an undated item instead of a dash', () => {
    render(<NewsCard news={{ ...base }} />);
    const undated = screen.getByTitle(/did not supply a publication date/i);
    expect(undated).toHaveTextContent('n/a');
  });

  it('keeps direction colours on the semantic tokens', () => {
    expect(getSentimentBadgeTone('bullish').color).toBe('text-[var(--color-positive)]');
    expect(getSentimentBadgeTone('bearish').color).toBe('text-[var(--color-negative)]');
    // A provider class outside the known set falls back to a neutral label.
    expect(getSentimentBadgeTone('sideways').label).toBe('Neutral');
  });
});
