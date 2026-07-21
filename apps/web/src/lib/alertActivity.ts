export type AlertActivitySource = 'price' | 'saved_screen' | 'prediction_market' | 'insider';
export type AlertDeliveryClass = 'browser_local' | 'polled' | 'server_backed';

export interface AlertActivity {
    id: string;
    source: AlertActivitySource;
    triggerTime: string;
    read: boolean;
    deliveryClass: AlertDeliveryClass;
    serverBacked: boolean;
    title: string;
    detail?: string;
    symbol?: string;
}

const STORAGE_KEY = 'vnibb-alert-activity-v1';
const CHANGE_EVENT = 'vnibb-alert-activity-change';
const MAX_ITEMS = 100;
let lastGoodActivity: AlertActivity[] = [];

function isActivity(value: unknown): value is AlertActivity {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<AlertActivity>;
    return typeof candidate.id === 'string'
        && (candidate.source === 'price' || candidate.source === 'saved_screen' || candidate.source === 'prediction_market' || candidate.source === 'insider')
        && typeof candidate.triggerTime === 'string'
        && typeof candidate.read === 'boolean'
        && (candidate.deliveryClass === 'browser_local' || candidate.deliveryClass === 'polled' || candidate.deliveryClass === 'server_backed')
        && typeof candidate.serverBacked === 'boolean'
        && typeof candidate.title === 'string';
}

export function readAlertActivity(): AlertActivity[] {
    if (typeof window === 'undefined') return [];
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(parsed)) return lastGoodActivity;
        lastGoodActivity = parsed.filter(isActivity).sort((left, right) => right.triggerTime.localeCompare(left.triggerTime));
        return lastGoodActivity;
    } catch {
        return lastGoodActivity;
    }
}

function writeAlertActivity(items: AlertActivity[]): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function recordAlertActivity(activity: Omit<AlertActivity, 'read'> & { read?: boolean }): void {
    const items = readAlertActivity();
    const existing = items.find((item) => item.id === activity.id);
    if (existing) {
        if (activity.read === undefined || activity.read === existing.read) return;
        writeAlertActivity(items.map((item) => item.id === activity.id ? { ...item, read: activity.read as boolean } : item));
        return;
    }
    writeAlertActivity([{ ...activity, read: activity.read ?? false }, ...items]);
}

export function markAlertActivityRead(id: string): void {
    writeAlertActivity(readAlertActivity().map((item) => item.id === id ? { ...item, read: true } : item));
}

export function subscribeAlertActivity(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(CHANGE_EVENT, listener);
    return () => window.removeEventListener(CHANGE_EVENT, listener);
}
