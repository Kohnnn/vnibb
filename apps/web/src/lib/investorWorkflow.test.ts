import { aggregateInvestorEvents, boundedSymbols, companyEventToInvestorEvent, isReviewDue, normalizeThesisConfig } from './investorWorkflow';

describe('investor workflow helpers', () => {
    it('deduplicates normalized symbols, preserves provider fields, and orders dates', () => {
        const first = companyEventToInvestorEvent({ symbol: ' fpt ', event_type: 'Dividend', event_date: '2026-08-02', event_name: 'Cash dividend' });
        const duplicate = companyEventToInvestorEvent({ symbol: 'FPT', event_type: 'Dividend', event_date: '2026-08-02', event_name: 'Different dividend row' });
        const earlier = companyEventToInvestorEvent({ symbol: 'VNM', action_category: 'MEETING', event_date: '2026-08-01', event_name: 'AGM' });

        const events = aggregateInvestorEvents([first!, duplicate!, earlier!], '2026-08-01');

        expect(events).toEqual([
            expect.objectContaining({ symbol: 'VNM', eventClass: 'MEETING', effectiveDate: '2026-08-01', source: 'Company events endpoint', provider: 'VNIBB company events' }),
            expect.objectContaining({ symbol: 'FPT', eventClass: 'DIVIDEND', effectiveDate: '2026-08-02' }),
        ]);
    });

    it('bounds source symbols in portfolio, watchlist, then manual order', () => {
        expect(boundedSymbols([['fpt', 'VNM'], ['FPT', 'HPG'], ['VCB']], 3)).toEqual(['FPT', 'VNM', 'HPG']);
    });

    it('normalizes legacy free-form notes without dropping structured fields and flags explicit due dates', () => {
        expect(normalizeThesisConfig({
            notesBySymbol: { fpt: 'Legacy note' },
            thesesBySymbol: { FPT: { status: 'active', thesis: 'Compounding', catalysts: 'Margin', risks: 'Multiple', invalidation: 'Demand', reviewDate: '2026-08-01' } },
        })).toEqual({
            notesBySymbol: { FPT: 'Legacy note' },
            thesesBySymbol: { FPT: { status: 'active', thesis: 'Compounding', catalysts: 'Margin', risks: 'Multiple', invalidation: 'Demand', reviewDate: '2026-08-01' } },
        });
        expect(isReviewDue('2026-08-01', '2026-08-01')).toBe(true);
        expect(isReviewDue('2026-08-02', '2026-08-01')).toBe(false);
    });

    it('keeps only deduplicated notebook item IDs from stored theses', () => {
        expect(normalizeThesisConfig({
            thesesBySymbol: {
                fpt: { notebookItemIds: ['nb:one', 'nb:one', 'bad id', 3, 'nb:two'] },
            },
        }).thesesBySymbol.FPT.notebookItemIds).toEqual(['nb:one', 'nb:two']);
    });
});
