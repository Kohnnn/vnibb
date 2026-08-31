import { isThesisComplete, type InvestmentThesis } from './investorWorkflow';

const complete: InvestmentThesis = {
  status: 'active',
  thesis: 'Durable earnings growth',
  catalysts: 'New capacity',
  risks: 'Execution risk',
  invalidation: 'Margin falls below target',
  reviewDate: '2026-12-31',
  notebookItemIds: ['nb:source-1'],
};

describe('isThesisComplete', () => {
  it('requires available evidence, risks, invalidation, and a review date', () => {
    expect(isThesisComplete(complete, new Set(['nb:source-1']))).toBe(true);
    expect(isThesisComplete(complete, new Set())).toBe(false);
    expect(isThesisComplete({ ...complete, notebookItemIds: [] }, new Set())).toBe(false);
    expect(isThesisComplete({ ...complete, risks: '' }, new Set(['nb:source-1']))).toBe(false);
    expect(isThesisComplete({ ...complete, invalidation: '' }, new Set(['nb:source-1']))).toBe(false);
    expect(isThesisComplete({ ...complete, reviewDate: '' }, new Set(['nb:source-1']))).toBe(false);
  });
});
