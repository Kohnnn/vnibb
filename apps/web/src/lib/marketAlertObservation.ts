import { parseAlertTime } from './alertTime';

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
    return observedAt <= now && now - observedAt < 60_000;
}

export function rejectFutureMarketObservation(
    rejected: Map<string, Set<number>>, symbol: string, observedAt: number, now: number,
): boolean {
    const clocks = rejected.get(symbol);
    if (clocks) {
        for (const clock of clocks) {
            if (now - clock >= 60_000) clocks.delete(clock);
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
