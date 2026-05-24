import { normalizeFinancialStatementPeriod } from '@/lib/api';

describe('normalizeFinancialStatementPeriod', () => {
  it('maps annual selectors to year', () => {
    expect(normalizeFinancialStatementPeriod('FY')).toBe('year');
    expect(normalizeFinancialStatementPeriod('fy')).toBe('year');
    expect(normalizeFinancialStatementPeriod('YEAR')).toBe('year');
    expect(normalizeFinancialStatementPeriod('Annual')).toBe('year');
    expect(normalizeFinancialStatementPeriod('A')).toBe('year');
  });

  it('maps quarter selectors to quarter', () => {
    expect(normalizeFinancialStatementPeriod('Q')).toBe('quarter');
    expect(normalizeFinancialStatementPeriod('Q1')).toBe('quarter');
    expect(normalizeFinancialStatementPeriod('Q2')).toBe('quarter');
    expect(normalizeFinancialStatementPeriod('Q3')).toBe('quarter');
    expect(normalizeFinancialStatementPeriod('Q4')).toBe('quarter');
    expect(normalizeFinancialStatementPeriod('quarter')).toBe('quarter');
  });

  it('maps trailing twelve-month selectors to TTM (uppercase to match backend Literal)', () => {
    expect(normalizeFinancialStatementPeriod('TTM')).toBe('TTM');
    expect(normalizeFinancialStatementPeriod('ttm')).toBe('TTM');
    expect(normalizeFinancialStatementPeriod('Trailing')).toBe('TTM');
  });

  it('returns undefined for empty input', () => {
    expect(normalizeFinancialStatementPeriod()).toBeUndefined();
    expect(normalizeFinancialStatementPeriod('')).toBeUndefined();
    expect(normalizeFinancialStatementPeriod('  ')).toBeUndefined();
  });

  it('passes through unknown values lowercased', () => {
    expect(normalizeFinancialStatementPeriod('CUSTOM')).toBe('custom');
  });
});
