import type { WidgetGroupId } from '@/types/widget';

/**
 * A purpose-bound research starter: it names one analyst intent, seeds the
 * workspace from an existing dashboard template, and primes VniAgent with the
 * matching starter prompt. It deliberately adds no second gallery — templates
 * remain the composition mechanism and prompt starters the agent mechanism.
 */
export interface ResearchStarter {
  id: ResearchStarterId;
  /** Short analyst-facing name, shown on the template card. */
  name: string;
  /** Short analyst-facing purpose, shown on the template card. */
  purpose: string;
  /** An id that must exist in DASHBOARD_TEMPLATES. */
  templateId: string;
  /** The ticker group the seeded widgets use unless the template says otherwise. */
  defaultGroup: WidgetGroupId;
  /** Must be one of the starter prompts AICopilot already accepts. */
  promptKey: StarterPromptKey;
  workflow: { id: string; revision: number };
  scope: 'symbol' | 'symbol_market' | 'matrix';
  requiredEvidenceKinds: readonly string[];
  limits: readonly string[];
}

export type StarterPromptKey = 'analyze' | 'technical';

export type ResearchStarterId =
  | 'fundamental-review'
  | 'peer-comparison'
  | 'news-impact'
  | 'earnings-watch'
  | 'global-context';

export const RESEARCH_STARTERS: readonly ResearchStarter[] = [
  {
    id: 'fundamental-review',
    name: 'Fundamental review',
    purpose: 'Review one ticker’s statements, ratios and risks end to end.',
    templateId: 'fundamental-analyst',
    defaultGroup: 'global',
    promptKey: 'analyze',
    workflow: { id: 'financial-summary', revision: 1 },
    scope: 'symbol',
    requiredEvidenceKinds: ['income_statement', 'balance_sheet', 'cash_flow', 'financial_ratios'],
    limits: ['Missing statements or ratios prevent a complete fundamental review.', 'Periods, units and unknown source dates must remain explicit.'],
  },
  {
    id: 'peer-comparison',
    name: 'Peer comparison',
    purpose: 'Compare several tickers on the same fundamentals before deciding.',
    templateId: 'comparison-lab',
    defaultGroup: 'A',
    promptKey: 'analyze',
    workflow: { id: 'peer-comparison', revision: 1 },
    scope: 'matrix',
    requiredEvidenceKinds: ['matrix_evidence'],
    limits: ['Requires an authorized frozen Matrix selection and its existing sector Research Playbook.', 'Selected cells do not establish whole-market coverage or comparability.'],
  },
  {
    id: 'news-impact',
    name: 'News impact',
    purpose: 'Turn today’s headlines into a view on what actually changed.',
    templateId: 'news-watcher',
    defaultGroup: 'global',
    promptKey: 'analyze',
    workflow: { id: 'news-impact', revision: 1 },
    scope: 'symbol',
    requiredEvidenceKinds: ['company_news', 'company_events'],
    limits: ['News summaries may be incomplete; no real-time or exhaustive event coverage.'],
  },
  {
    id: 'earnings-watch',
    name: 'Earnings watch',
    purpose: 'Track the earnings calendar and the setup into the print.',
    templateId: 'earnings-season',
    defaultGroup: 'global',
    promptKey: 'technical',
    workflow: { id: 'earnings-forecast', revision: 1 },
    scope: 'symbol',
    requiredEvidenceKinds: ['income_statement', 'company_events'],
    limits: ['Outlooks are conditional scenarios, not verified forecasts.', 'Do not invent earnings dates, consensus or unreported results.'],
  },
  {
    id: 'global-context',
    name: 'Global context',
    purpose: 'Place one ticker against global markets and the technical setup.',
    templateId: 'global-markets',
    defaultGroup: 'B',
    promptKey: 'technical',
    workflow: { id: 'global-context', revision: 1 },
    scope: 'symbol_market',
    requiredEvidenceKinds: ['price_history', 'market_indices', 'sector_breadth'],
    limits: ['Domestic index and sector evidence does not establish global-market coverage.', 'No live-price or execution guarantee.'],
  },
];

export function getStarterForTemplate(templateId: string): ResearchStarter | undefined {
  return RESEARCH_STARTERS.find((starter) => starter.templateId === templateId);
}

export function getStarterForWorkflow(workflow: { id: string; revision: number }): ResearchStarter | undefined {
  return RESEARCH_STARTERS.find((starter) => starter.workflow.id === workflow.id && starter.workflow.revision === workflow.revision);
}

/** Describes ticker sharing and the detach control before widgets are added. */
export function describeStarterDisclosure(
  starter: ResearchStarter,
  options: { sharedTickerGroups: readonly WidgetGroupId[] } = { sharedTickerGroups: [] },
): string {
  const shared = options.sharedTickerGroups.filter((group) => group === starter.defaultGroup);
  const tickerDisclosure = shared.length
    ? `${starter.name} seeds this workspace with widgets that share the ${shared.join('/')} ticker.`
    : `${starter.name} seeds this workspace with widgets following the workspace ticker. To keep one ticker in a widget, detach it from its group.`;
  return `${tickerDisclosure} Reviewed workflow ${starter.workflow.id}@${starter.workflow.revision}. Scope: ${starter.scope}. Requires: ${starter.requiredEvidenceKinds.join(', ')}. ${starter.limits.join(' ')} Missing evidence will be reported, not invented.`;
}
