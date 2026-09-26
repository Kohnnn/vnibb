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
  },
  {
    id: 'peer-comparison',
    name: 'Peer comparison',
    purpose: 'Compare several tickers on the same fundamentals before deciding.',
    templateId: 'comparison-lab',
    defaultGroup: 'A',
    promptKey: 'analyze',
  },
  {
    id: 'news-impact',
    name: 'News impact',
    purpose: 'Turn today’s headlines into a view on what actually changed.',
    templateId: 'news-watcher',
    defaultGroup: 'global',
    promptKey: 'analyze',
  },
  {
    id: 'earnings-watch',
    name: 'Earnings watch',
    purpose: 'Track the earnings calendar and the setup into the print.',
    templateId: 'earnings-season',
    defaultGroup: 'global',
    promptKey: 'technical',
  },
  {
    id: 'global-context',
    name: 'Global context',
    purpose: 'Place one ticker against global markets and the technical setup.',
    templateId: 'global-markets',
    defaultGroup: 'B',
    promptKey: 'technical',
  },
];

export function getStarterForTemplate(templateId: string): ResearchStarter | undefined {
  return RESEARCH_STARTERS.find((starter) => starter.templateId === templateId);
}

/**
 * The disclosure shown before a starter is applied. States the shared-ticker
 * consequence the seeded widgets actually have, so applying is never a surprise.
 */
export function describeStarterDisclosure(
  starter: ResearchStarter,
  options: { sharedTickerGroups: readonly WidgetGroupId[] } = { sharedTickerGroups: [] },
): string {
  const shared = options.sharedTickerGroups.filter((group) => group === starter.defaultGroup);
  return shared.length
    ? `${starter.name} seeds this workspace with widgets that share the ${shared.join('/')} ticker.`
    : `${starter.name} seeds this workspace; its widgets keep their own tickers until you link a group.`;
}
