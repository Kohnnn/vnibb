export interface MarketCapObservation {
  value: number | null;
  source: string;
  unit: string | null;
  currency: string | null;
  as_of: string | null;
  shares: number | null;
  shares_unit: string | null;
  shares_as_of: string | null;
  share_basis: string | null;
  price: number | null;
  price_unit: string | null;
  price_as_of: string | null;
  calculation: string | null;
  [key: string]: unknown;
}

export interface MarketCapProvenance {
  status: 'available' | 'conflict' | 'unavailable';
  value: number | null;
  reason: string | null;
  source: string | null;
  currency: 'VND' | null;
  unit: 'VND' | null;
  as_of: string | null;
  share_basis: 'outstanding' | null;
  observations: MarketCapObservation[];
  shares_as_of?: string | null;
  shares_unit?: string | null;
  shares_source?: string | null;
  [key: string]: unknown;
}

export interface MarketCapInput {
  label: string;
  value?: number | null;
  provenance?: MarketCapProvenance | null;
}

export interface MarketCapResult {
  status: 'available' | 'conflict' | 'unavailable';
  value: number | null;
  reason: string;
  inputs: MarketCapInput[];
}

export function resolveMarketCap(...inputs: MarketCapInput[]): MarketCapResult {
  const result = (status: MarketCapResult['status'], value: number | null, reason: string): MarketCapResult =>
    ({ status, value, reason, inputs });
  const conflict = inputs.find(({ provenance }) => provenance?.status === 'conflict');
  if (conflict) return result('conflict', null, conflict.provenance?.reason || 'Source reports conflicting market-cap observations.');

  const certified = inputs.filter(({ value, provenance: p }) =>
    p?.status === 'available' && typeof value === 'number' && Number.isFinite(value) && value > 0 &&
    p.value === value && p.currency === 'VND' && p.unit === 'VND' &&
    typeof p.source === 'string' && p.source.trim() !== '' &&
    typeof p.as_of === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(p.as_of) &&
    Number.isFinite(Date.parse(p.as_of)) && p.share_basis === 'outstanding' &&
    Array.isArray(p.observations) && p.observations.length > 0);
  if (inputs.some((input) => input.provenance?.status === 'available' && !certified.includes(input))) {
    return result('unavailable', null, 'A market-cap certification has an unknown or incompatible value, unit, source, date, or share basis.');
  }
  if (certified.length > 1) {
    const first = certified[0];
    if (certified.some(({ value, provenance }) => Math.abs(value! - first.value!) > Math.max(0.01, 1e-9 * Math.max(Math.abs(value!), Math.abs(first.value!))) ||
      provenance?.as_of?.slice(0, 10) !== first.provenance?.as_of?.slice(0, 10) || provenance?.share_basis !== first.provenance?.share_basis)) {
      return result('conflict', null, 'Certified market-cap values, dates, or share bases disagree.');
    }
  }
  if (certified.length && inputs.some((input) => !certified.includes(input) && (
    input.value != null || input.provenance?.observations?.some((observation) => observation.value != null)
  ))) {
    return result('unavailable', null, 'An unqualified market-cap observation cannot be reconciled with the certified value.');
  }
  if (certified.length) return result('available', certified[0].value!, certified[0].provenance?.reason || 'Certified market cap.');
  const reason = inputs.find(({ provenance }) => provenance?.reason)?.provenance?.reason;
  return result('unavailable', null, reason || 'Market cap lacks certified VND unit, source, date, outstanding-share basis, or matching value.');
}

export function marketCapExplanation(result: MarketCapResult): string {
  return `${result.reason} ${result.inputs.map(({ label, value, provenance }) =>
    `${label}: value ${value ?? 'unknown'}; status ${provenance?.status ?? 'unknown'}; reason ${provenance?.reason ?? 'unknown'}; source ${provenance?.source ?? 'unknown'}; unit ${provenance?.unit ?? 'unknown'}; currency ${provenance?.currency ?? 'unknown'}; date ${provenance?.as_of ?? 'unknown'}; share basis ${provenance?.share_basis ?? 'unknown'}; shares date ${provenance?.shares_as_of ?? 'unknown'}; shares unit ${provenance?.shares_unit ?? 'unknown'}; shares source ${provenance?.shares_source ?? 'unknown'}; observations ${JSON.stringify(provenance?.observations ?? [])}`
  ).join(' | ')}`;
}
