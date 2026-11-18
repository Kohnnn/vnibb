import { logClientWarn } from '@/lib/clientLogger';
import { parseAlertTime } from './alertTime';
import { readDesktopAlertOptIn, readDesktopAlertPermission } from './desktopAlertPreferences';

const LEDGER_KEY = 'vnibb-desktop-alert-ledger-v1';
const FRESHNESS_MS = 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RETAINED_EVENTS = 4096;

type DesktopAlertEvent = {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly triggerTime: string;
};

export function sendDesktopAlerts(events: readonly DesktopAlertEvent[]): boolean {
  if (events.length === 0) return false;
  const optedInAt = readDesktopAlertOptIn();
  const maySend = optedInAt !== null && readDesktopAlertPermission() === 'granted';
  const now = Date.now();
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? '[]');
    if (!Array.isArray(raw)) return false;
    const retained = new Map<string, number>();
    for (const entry of raw) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[1] > now) {
        retained.set(entry[0], entry[1]);
      }
    }
    const before = retained.size;
    const eligible: DesktopAlertEvent[] = [];
    for (const event of events) {
      if (retained.has(event.id) || retained.size >= MAX_RETAINED_EVENTS) continue;
      const eventTime = parseAlertTime(event.triggerTime);
      if (eventTime !== null && now - eventTime >= FRESHNESS_MS) continue;
      // Remember suppressed observations as well as attempts. A future event must
      // not become a new alert when the clock catches up, even after a reload.
      retained.set(event.id, Math.max(now + RETENTION_MS, (eventTime ?? now) + FRESHNESS_MS));
      if (maySend && eventTime !== null && eventTime >= optedInAt && eventTime <= now) {
        eligible.push(event);
      }
    }
    if (retained.size > before) window.localStorage.setItem(LEDGER_KEY, JSON.stringify([...retained]));

    const [first] = eligible;
    if (!first) return false;
    const title = eligible.length === 1 ? first.title : eligible.length + ' new alerts';
    const body = eligible.length === 1 ? first.detail : eligible.map((event) => event.title).slice(0, 3).join('; ');
    new window.Notification(title, { body, tag: first.id });
    return true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    logClientWarn('Desktop alert could not be shown', { name: error.name });
    return false;
  }
}
