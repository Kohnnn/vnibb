import {
    incomparableReason,
    priorYearQuarterKey,
    quarterKey,
    rowForQuarter,
    withheldFieldReason,
} from './statementAdmission';

const row = (period: string, overrides: Record<string, unknown> = {}) => ({
    period,
    currency: 'VND',
    value_unit: 'VND',
    consolidation_basis: 'consolidated',
    flow_basis: 'single_quarter',
    source: 'vietcap',
    ...overrides,
});

describe('quarter identity', () => {
    it('reads every spelling of a fiscal quarter', () => {
        expect(quarterKey('2025-Q2')).toBe('2025-Q2');
        expect(quarterKey('Q2-2025')).toBe('2025-Q2');
        expect(quarterKey('2025 Q2')).toBe('2025-Q2');
        expect(quarterKey('2025')).toBeNull();
        expect(quarterKey('')).toBeNull();
    });

    it('maps to the same quarter one year earlier, never to a sequential one', () => {
        expect(priorYearQuarterKey('2025-Q2')).toBe('2024-Q2');
        expect(priorYearQuarterKey('2025-Q1')).toBe('2024-Q1');
        expect(priorYearQuarterKey('2025')).toBeNull();
    });

    it('selects the exact quarter with no fallback to a neighbour', () => {
        const rows = [row('2025-Q2'), row('2025-Q1'), row('2024-Q2')];
        expect(rowForQuarter(rows, '2024-Q2')?.period).toBe('2024-Q2');
        expect(rowForQuarter(rows, '2023-Q2')).toBeNull();
        expect(rowForQuarter(null, '2024-Q2')).toBeNull();
    });
});

describe('comparability', () => {
    it('compares two rows that declare the same basis', () => {
        expect(incomparableReason(row('2025-Q2'), row('2024-Q2'))).toBeNull();
    });

    it('refuses a missing period rather than substituting the latest row', () => {
        expect(incomparableReason(row('2025-Q2'), null)).toBe('missing comparison period');
    });

    it.each(['currency', 'value_unit', 'consolidation_basis', 'flow_basis'])(
        'treats an unknown %s as unconfirmed, even when both sides say unknown',
        (key) => {
            const reason = incomparableReason(
                row('2025-Q2', { [key]: 'unknown' }),
                row('2024-Q2', { [key]: 'unknown' }),
            );
            expect(reason).toBe(`reporting basis not confirmed (${key.replace(/_/g, ' ')})`);
        },
    );

    it('names a differing basis instead of comparing across it', () => {
        expect(incomparableReason(row('2025-Q2'), row('2024-Q2', { consolidation_basis: 'separate' }))).toBe(
            'reporting basis differs (consolidation basis)',
        );
        expect(incomparableReason(row('2025-Q2'), row('2024-Q2', { source: 'vci' }))).toBe(
            'source differs (vietcap vs vci)',
        );
    });

    it('reports an explicitly unavailable row', () => {
        expect(incomparableReason(row('2025-Q2', { unavailable_reason: 'duplicate_period' }), row('2024-Q2'))).toBe(
            'current period unavailable (duplicate_period)',
        );
    });
});

describe('field admission', () => {
    it('finds a field rejection in either evidence location', () => {
        const reason = 'unverified_statement_currency_or_unit';
        expect(withheldFieldReason({ unit_metadata: { revenue: { unavailable_reason: reason } } }, 'revenue')).toBe(reason);
        expect(
            withheldFieldReason(
                {
                    raw_data: {
                        _financial_lineage: { canonical_data: { unit_metadata: { revenue: { unavailable_reason: reason } } } },
                    },
                },
                'revenue',
            ),
        ).toBe(reason);
        expect(withheldFieldReason({ unit_metadata: { revenue: { source_unit: 'VND' } } }, 'revenue')).toBeNull();
        expect(withheldFieldReason(null, 'revenue')).toBeNull();
    });
});
