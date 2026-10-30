import { resolveMarketCap, type MarketCapProvenance } from './marketCap';

const certified: MarketCapProvenance = {
  status: 'available', value: 57.3, reason: null, source: 'source', currency: 'VND', unit: 'VND',
  as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 57.3, source: 'source', unit: 'VND', currency: 'VND', as_of: '2026-10-26', shares: 1, shares_unit: 'shares', shares_as_of: '2026-10-26', share_basis: 'outstanding', price: null, price_unit: null, price_as_of: null, calculation: null }],
};
const input = (provenance: MarketCapProvenance, value = 57.3) => ({ label: 'source', value, provenance });

test('accepts aligned certified low VND values without scaling', () => {
  expect(resolveMarketCap(input(certified), input(certified))).toMatchObject({ status: 'available', value: 57.3 });
});

test('accepts certified rounding within backend relative and absolute tolerances on the same day', () => {
  const near = { ...certified, value: 57.309, as_of: '2026-10-26T12:00:00+07:00' };
  expect(resolveMarketCap(input(certified), input(near, near.value!))).toMatchObject({ status: 'available', value: 57.3 });
  const large = { ...certified, value: 22_065_241_363_750 };
  const rounded = { ...large, value: large.value + 10_000 };
  expect(resolveMarketCap(input(large, large.value), input(rounded, rounded.value)).status).toBe('available');
});

test('rejects mismatched top-level and provenance values even within tolerance', () => {
  expect(resolveMarketCap(input(certified, 57.301)).status).toBe('unavailable');
});

test('rejects materially different certified values', () => {
  const large = { ...certified, value: 22_065_241_363_750 };
  const different = { ...large, value: large.value + 30_000 };
  expect(resolveMarketCap(input(large, large.value), input(different, different.value)).status).toBe('conflict');
});

test('rejects bare captured VCI caps', () => {
  expect(resolveMarketCap({ label: 'profile', value: 22065241363750 }, { label: 'screener', value: 22410910941.25 })).toMatchObject({ status: 'unavailable', value: null });
});

test.each([
  { unit: null }, { currency: null }, { as_of: null }, { share_basis: null }, { source: null },
  { observations: [] },
])('rejects incomplete certification %o', (missing) => {
  expect(resolveMarketCap(input({ ...certified, ...missing }))).toMatchObject({ status: 'unavailable', value: null });
});

test('rejects conflicting values or dates', () => {
  expect(resolveMarketCap(input(certified), input({ ...certified, value: 58 }, 58)).status).toBe('conflict');
  expect(resolveMarketCap(input(certified), input({ ...certified, as_of: '2026-10-25' })).status).toBe('conflict');
});

test('does not admit a valid source alongside an invalid available certification', () => {
  expect(resolveMarketCap(input(certified), input({ ...certified, unit: null })).status).toBe('unavailable');
});

test('withholds a certified value when another source has an unqualified cap', () => {
  const bare = { label: 'screener', value: 22410910941.25 };
  const unavailable = {
    label: 'screener', value: null,
    provenance: { ...certified, status: 'unavailable' as const, value: null, reason: 'Unit unknown', observations: [{ ...certified.observations[0], value: 22410910941.25, unit: null }] },
  };
  for (const unresolved of [bare, unavailable]) {
    const result = resolveMarketCap(input(certified), unresolved);
    expect(result).toMatchObject({ status: 'unavailable', value: null, reason: expect.stringContaining('unqualified'), inputs: [input(certified), unresolved] });
  }
  expect(resolveMarketCap(input(certified), { label: 'empty' }).status).toBe('available');
});
