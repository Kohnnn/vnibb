// Custom user-saved dashboard templates.
//
// QA-v4: The built-in template list (Global Markets / Fundamentals /
// Technical / etc.) is fixed and read-only — users have no way to
// snapshot their current layout and reuse it later. This module adds a
// local-storage-backed custom-template store + helpers so the
// TemplateSelector can show "Your saved layouts" alongside the
// built-ins.
//
// Storage key: vnibb:custom-templates:v1 (JSON array).
// We keep the schema identical to DASHBOARD_TEMPLATES so the existing
// TemplateSelector and hydration paths stay unchanged.

import type { DashboardTemplate, DashboardTemplateCategory } from '@/types/dashboard-templates';
import type { Dashboard, WidgetConfig } from '@/types/dashboard';

const STORAGE_KEY = 'vnibb:custom-templates:v1';

export interface CustomDashboardTemplate extends DashboardTemplate {
  isCustom: true;
  createdAt: string;
  updatedAt: string;
  /** Source dashboard id we snapshot'ed from (for reference, not used to refresh). */
  sourceDashboardId?: string;
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadCustomTemplates(): CustomDashboardTemplate[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CustomDashboardTemplate =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.widgets)
    );
  } catch {
    return [];
  }
}

function persist(templates: CustomDashboardTemplate[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch (error) {
    // Quota exceeded or storage disabled — fail silently. The user can still
    // create / use templates within the current session via in-memory state
    // managed by the consumer.
    // eslint-disable-next-line no-console
    console.warn('VNIBB: failed to persist custom templates', error);
  }
}

function makeId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'template';
  return `custom-${base}-${Date.now().toString(36)}`;
}

export function saveCustomTemplate(input: {
  name: string;
  description?: string;
  category?: DashboardTemplateCategory;
  dashboard: Dashboard;
}): CustomDashboardTemplate {
  const allTabs = input.dashboard.tabs || [];
  const widgets = allTabs.flatMap((tab) =>
    (tab.widgets || []).map((widget) => ({
      type: widget.type,
      layout: {
        x: widget.layout.x,
        y: widget.layout.y,
        w: widget.layout.w,
        h: widget.layout.h,
        minW: widget.layout.minW,
        minH: widget.layout.minH,
      },
      config: widget.config as WidgetConfig | undefined,
    }))
  );

  const now = new Date().toISOString();
  const template: CustomDashboardTemplate = {
    id: makeId(input.name),
    name: input.name,
    description:
      input.description?.trim() ||
      `Saved on ${new Date().toLocaleDateString()} from ${input.dashboard.name}`,
    category: input.category || 'market',
    widgets,
    isCustom: true,
    createdAt: now,
    updatedAt: now,
    sourceDashboardId: input.dashboard.id,
  };

  const existing = loadCustomTemplates();
  // Replace by id if user re-saves under the exact same id
  const next = [
    ...existing.filter((t) => t.id !== template.id),
    template,
  ];
  persist(next);
  return template;
}

export function deleteCustomTemplate(id: string): void {
  const next = loadCustomTemplates().filter((t) => t.id !== id);
  persist(next);
}

export function renameCustomTemplate(id: string, name: string): CustomDashboardTemplate | null {
  const list = loadCustomTemplates();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const updated = { ...list[idx], name: name.trim() || list[idx].name, updatedAt: new Date().toISOString() };
  list[idx] = updated;
  persist(list);
  return updated;
}

/**
 * Export a template to a downloadable JSON file. Triggered from the
 * TemplateSelector "..." menu so users can share layouts across browsers
 * or back them up before clearing localStorage.
 */
export function downloadCustomTemplate(template: CustomDashboardTemplate): void {
  if (!isBrowser()) return;
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${template.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importCustomTemplateFromJson(json: string): CustomDashboardTemplate {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.widgets)) {
    throw new Error('Invalid template JSON: missing widgets array');
  }
  const now = new Date().toISOString();
  const template: CustomDashboardTemplate = {
    id: typeof parsed.id === 'string' && parsed.id ? parsed.id : makeId(parsed.name || 'imported'),
    name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Imported template',
    description: typeof parsed.description === 'string' ? parsed.description : 'Imported template',
    category: (parsed.category as DashboardTemplateCategory) || 'market',
    widgets: parsed.widgets,
    isCustom: true,
    createdAt: parsed.createdAt || now,
    updatedAt: now,
    sourceDashboardId: parsed.sourceDashboardId,
  };
  const existing = loadCustomTemplates();
  const next = [...existing.filter((t) => t.id !== template.id), template];
  persist(next);
  return template;
}
