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
  it('requires evidence, risks, invalidation, and a review date', () => {
    expect(isThesisComplete(complete)).toBe(true);
    expect(isThesisComplete({ ...complete, notebookItemIds: [] })).toBe(false);
    expect(isThesisComplete({ ...complete, risks: '' })).toBe(false);
    expect(isThesisComplete({ ...complete, invalidation: '' })).toBe(false);
    expect(isThesisComplete({ ...complete, reviewDate: '' })).toBe(false);
  });
});
