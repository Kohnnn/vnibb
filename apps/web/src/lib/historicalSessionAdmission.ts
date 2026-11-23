import type { EquityHistoricalData, EquityHistoricalResponse } from '@/types/equity';

export type HistoricalSessionAdmission = {
  reason: string | null;
  expectedSessionDates: readonly string[];
  unit: 'VND' | 'index_points' | null;
  basis: 'adjusted' | 'not_applicable' | null;
};

function isOrderedDate(value: string, previous?: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || (previous !== undefined && value <= previous)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function getHistoricalSessionAdmission(response?: EquityHistoricalResponse): HistoricalSessionAdmission {
  const unavailable = (reason: string): HistoricalSessionAdmission => ({
    reason, expectedSessionDates: [], unit: null, basis: null,
  });
  if (!response) return unavailable('Historical session coverage unavailable.');
  if (response.error) return unavailable('Historical price request failed.');
  if (!response.data.length) return unavailable('No historical observations were returned.');

  const { meta, data } = response;
  const unit = meta?.unit_status === 'confirmed_vnd'
    ? 'VND'
    : meta?.unit_status === 'not_applicable' ? 'index_points' : null;
  if (!unit || !data.every((row) => row.price_unit === unit)) {
    return unavailable('Historical price units were not certified.');
  }
  const sessions = meta?.expected_session_dates;
  if (
    meta?.calendar_verified !== true || !Array.isArray(sessions) || !sessions.length
    || !sessions.every((day, i) => isOrderedDate(day, sessions[i - 1]))
    || !Number.isInteger(meta.unresolved_session_count)
    || !Array.isArray(meta.unresolved_excluded_dates)
    || meta.unresolved_session_count !== meta.unresolved_excluded_dates.length
  ) {
    return unavailable('Verified historical calendar and admission evidence unavailable for this request.');
  }
  const basis = unit === 'index_points' && meta.session_basis === 'not_applicable'
    && data.every((row) => row.adjustment_applied === false && row.raw_close === row.close)
    ? 'not_applicable'
    : unit === 'VND' && meta.session_basis === 'adjusted'
      && data.every((row) => row.adjustment_mode === 'adjusted' && row.adjustment_applied === true)
      ? 'adjusted' : null;
  if (!basis) return unavailable('Historical session price basis is unverified or mixed.');

  const sessionDates = new Set(sessions);
  if (!data.every((row, i) => sessionDates.has(row.time) && (i === 0 || row.time > data[i - 1].time))) {
    return unavailable('Returned bars do not match distinct, ordered exchange sessions.');
  }
  const returnedDates = new Set(data.map((row) => row.time));
  if (!meta.unresolved_excluded_dates.every((day, i, days) => (
    isOrderedDate(day, days[i - 1]) && sessionDates.has(day) && !returnedDates.has(day)
  ))) {
    return unavailable('Unresolved historical dates conflict with returned session evidence.');
  }
  return { reason: null, expectedSessionDates: sessions, unit, basis };
}

export function isUsableHistoricalOHLC(row: EquityHistoricalData): boolean {
  return [row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0)
    && row.low <= Math.min(row.open, row.close)
    && row.high >= Math.max(row.open, row.close);
}