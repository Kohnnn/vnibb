import { __resolveDashboardSlug as resolveDashboardSlug } from '@/hooks/useUrlSync';

/**
 * DEF-02: deep-link slug aliases must resolve to canonical dashboard ids so
 * shared/bookmarked links (e.g. `?dashboard=default-global`) don't silently
 * fall back to the default dashboard.
 */
describe('resolveDashboardSlug', () => {
  const valid = [
    'default-fundamental',
    'default-technical',
    'default-quant',
    'default-global-markets',
  ];

  it('returns the slug unchanged when it is already a valid id', () => {
    expect(resolveDashboardSlug('default-quant', valid)).toBe('default-quant');
  });

  it('maps the legacy default-global slug to default-global-markets', () => {
    expect(resolveDashboardSlug('default-global', valid)).toBe('default-global-markets');
  });

  it('maps short aliases to their canonical ids', () => {
    expect(resolveDashboardSlug('global', valid)).toBe('default-global-markets');
    expect(resolveDashboardSlug('global-markets', valid)).toBe('default-global-markets');
    expect(resolveDashboardSlug('fundamental', valid)).toBe('default-fundamental');
    expect(resolveDashboardSlug('technical', valid)).toBe('default-technical');
    expect(resolveDashboardSlug('quant', valid)).toBe('default-quant');
  });

  it('returns null for unknown slugs', () => {
    expect(resolveDashboardSlug('does-not-exist', valid)).toBeNull();
  });

  it('returns null when the alias target is not in the valid set', () => {
    expect(resolveDashboardSlug('global', ['default-fundamental'])).toBeNull();
  });
});
