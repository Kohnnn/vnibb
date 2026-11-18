import { parseAlertTime } from './alertTime';

const MARKET_OBSERVATION_FRESHNESS_MS = 60_000;
const futurePrices = new Map<string, Set<number>>();

export function parseMarketObservationTime(value: unknown): number | null {
    if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || value.slice(11, 13) === '24') {
        return null;
    }
    const observedAt = parseAlertTime(value);
    if (observedAt === null) return null;
    const day = value.slice(0, 10);
    const midnight = new Date(`${day}T00:00:00Z`);
    return midnight.toISOString().startsWith(day) ? observedAt : null;
}

export function isFreshMarketObservation(observedAt: number, now: number): boolean {
    return observedAt <= now && now - observedAt < MARKET_OBSERVATION_FRESHNESS_MS;
}

export function rejectFutureMarketObservation(
    rejected: Map<string, Set<number>>, symbol: string, observedAt: number, now: number,
): boolean {
    const clocks = rejected.get(symbol);
    if (clocks) {
        for (const clock of clocks) {
            if (now - clock >= MARKET_OBSERVATION_FRESHNESS_MS) clocks.delete(clock);
        }
    }
    if (observedAt > now) {
        if (clocks) clocks.add(observedAt);
        else rejected.set(symbol, new Set([observedAt]));
        return true;
    }
    if (clocks?.size === 0) rejected.delete(symbol);
    return clocks?.has(observedAt) ?? false;
}

export function rejectFuturePriceObservation(symbol: string, observedAt: number, now: number): boolean {
    const key = `vnibb-future-price-observations-v1:${symbol}`;
    let stored: string | null = null;
    try {
        stored = window.localStorage.getItem(key);
        const clocks: unknown = stored === null ? null : JSON.parse(stored);
        if (Array.isArray(clocks)) {
            const known = futurePrices.get(symbol) ?? new Set<number>();
            for (const clock of clocks) {
                if (typeof clock === 'number' && Number.isFinite(clock)) known.add(clock);
            }
            futurePrices.set(symbol, known);
        }
    } catch {
        // The current browser session can still retain a rejection when storage is unavailable.
    }

    const rejected = rejectFutureMarketObservation(futurePrices, symbol, observedAt, now);
    try {
        const clocks = futurePrices.get(symbol);
        const next = clocks ? JSON.stringify([...clocks]) : null;
        if (next !== null && next !== stored) window.localStorage.setItem(key, next);
        if (next === null && stored !== null) window.localStorage.removeItem(key);
    } catch {
        // Keep the in-memory rejection.
    }
    return rejected;
}
