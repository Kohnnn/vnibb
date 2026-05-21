// Recommended templates based on the user's recent activity.
//
// QA-v4: The previous "Dashboard Templates" picker shows ~12 fixed
// layouts in alphabetical-ish order. Power users want a "Recommended
// for you" row at the top that surfaces the templates most likely
// useful given the current symbol, the workspaces they've recently
// visited, and the time-of-day market state.
//
// We keep the heuristic local + dependency-free so it works offline,
// but expose a clear scoring contract so the LLM-backed VniAgent can
// later replace the heuristic with a true recommender without
// changing the modal UI.

import {
  DASHBOARD_TEMPLATES,
  type DashboardTemplate,
  type DashboardTemplateCategory,
} from '@/types/dashboard-templates';
import { getMarketState } from '@/lib/marketHours';

const STORAGE_KEY = 'vnibb:template-recent-uses:v1';
const MAX_HISTORY = 30;

export interface TemplateUseEvent {
  templateId: string;
  category: DashboardTemplateCategory;
  symbol: string | null;
  usedAt: string; // ISO
}

export interface RecommendedTemplate {
  template: DashboardTemplate;
  score: number;
  reason: string;
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadTemplateHistory(): TemplateUseEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TemplateUseEvent =>
        Boolean(item) &&
        typeof item.templateId === 'string' &&
        typeof item.category === 'string' &&
        typeof item.usedAt === 'string'
    );
  } catch {
    return [];
  }
}

export function recordTemplateUse(template: DashboardTemplate, symbol: string | null): void {
  if (!isBrowser()) return;
  const history = loadTemplateHistory();
  const event: TemplateUseEvent = {
    templateId: template.id,
    category: template.category,
    symbol: symbol ? symbol.toUpperCase() : null,
    usedAt: new Date().toISOString(),
  };
  const next = [event, ...history].slice(0, MAX_HISTORY);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export function recommendTemplates(options?: {
  currentSymbol?: string | null;
  excludeIds?: string[];
  limit?: number;
}): RecommendedTemplate[] {
  const { currentSymbol = null, excludeIds = [], limit = 4 } = options || {};
  const history = loadTemplateHistory();
  const exclude = new Set(excludeIds);

  // Frequency by category in the last MAX_HISTORY uses
  const categoryFrequency: Partial<Record<DashboardTemplateCategory, number>> = {};
  for (const event of history) {
    categoryFrequency[event.category] = (categoryFrequency[event.category] || 0) + 1;
  }

  // Most recently used template ids (boost)
  const recentIds = new Set(history.slice(0, 6).map((event) => event.templateId));

  // Time-of-day signal: during HOSE open hours, prioritise market/technical
  // categories; outside hours favour fundamentals/research.
  const marketState = getMarketState();
  const isOpen = marketState.isOpen;

  const scored: RecommendedTemplate[] = DASHBOARD_TEMPLATES
    .filter((template) => !exclude.has(template.id))
    .map((template) => {
      let score = 0;
      const reasons: string[] = [];

      // Recent-use boost (decays from +5 to +1 across the last 6 uses).
      const indexInRecent = history.slice(0, 6).findIndex((event) => event.templateId === template.id);
      if (indexInRecent >= 0) {
        score += 5 - indexInRecent;
        reasons.push('Recently used');
      } else if (recentIds.has(template.id)) {
        score += 1;
      }

      // Category frequency boost
      const freq = categoryFrequency[template.category] || 0;
      if (freq > 0) {
        score += Math.min(freq * 0.5, 4);
        if (freq >= 3) reasons.push(`${template.category} workflow`);
      }

      // Market-state preference
      if (isOpen) {
        if (template.category === 'market' || template.category === 'technical') {
          score += 1.5;
          reasons.push('Market open');
        }
      } else {
        if (template.category === 'fundamentals' || template.category === 'research') {
          score += 1.5;
          reasons.push('Off-hours research');
        }
      }

      // First-time user gets a balanced default mix
      if (history.length === 0) {
        if (['main-dashboard', 'market-pulse', 'fundamentals-deep-dive', 'global-markets'].includes(template.id)) {
          score += 2;
          reasons.push('Popular starter');
        }
      }

      // Symbol-context heuristics. If the user is viewing a Vietnamese
      // ticker and the template is global-only, slightly de-rank it.
      if (currentSymbol) {
        if (template.id === 'global-markets' || template.id === 'world-monitor') {
          score -= 0.8;
        }
      }

      const reason = reasons[0] || 'Suggested';
      return { template, score, reason };
    })
    .filter((item) => item.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}
