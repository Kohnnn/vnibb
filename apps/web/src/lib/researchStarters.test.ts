import { describeStarterDisclosure, RESEARCH_STARTERS } from './researchStarters';

test('starter confirmation explains the shared ticker and how to detach a widget', () => {
  const starter = RESEARCH_STARTERS.find((candidate) => candidate.id === 'peer-comparison');
  expect(starter).toBeDefined();
  const disclosure = describeStarterDisclosure(starter!, { sharedTickerGroups: [] });

  expect(disclosure).toMatch(/widgets following the workspace ticker/i);
  expect(disclosure).toMatch(/detach it from its group/i);
  expect(disclosure).not.toMatch(/keep their own tickers until/i);
  expect(disclosure).not.toMatch(/following the A ticker/i);
});

test.each(RESEARCH_STARTERS)('$id discloses reviewed identity, scope and mandatory evidence before starting', (starter) => {
  const disclosure = describeStarterDisclosure(starter);
  expect(starter.workflow.revision).toBeGreaterThan(0);
  expect(starter.requiredEvidenceKinds.length).toBeGreaterThan(0);
  expect(starter.limits.length).toBeGreaterThan(0);
  expect(disclosure).toContain(`${starter.workflow.id}@${starter.workflow.revision}`);
  expect(disclosure).toContain(`Scope: ${starter.scope}`);
  for (const kind of starter.requiredEvidenceKinds) expect(disclosure).toContain(kind);
  expect(disclosure).toContain('Missing evidence will be reported, not invented');
});
