type Association = {
  association_class?: string | null;
  is_market_wide_fallback?: boolean;
  match_evidence?: unknown;
};

export function hasNewsAssociationEvidence(item: Association, includeSector = true): boolean {
  if (item.is_market_wide_fallback) return false;
  const kinds = item.association_class === 'direct_company' ? ['symbol', 'company_name']
    : item.association_class === 'verified_peer' ? ['peer_symbol']
      : item.association_class === 'verified_sector' && includeSector ? ['sector_keyword'] : [];
  const evidence = item.match_evidence;
  if (!evidence || typeof evidence !== 'object' || !('matched_terms' in evidence)) return false;
  const terms = evidence.matched_terms;
  const hasTerm = Array.isArray(terms) && terms.some(term =>
    term && (term.field === 'title' || term.field === 'body') && kinds.includes(term.kind || '') &&
    typeof term.term === 'string' && term.term.trim().length > 0
  );
  if (!hasTerm) return false;
  if (item.association_class === 'direct_company') return true;
  if (!('classification' in evidence) || !evidence.classification || typeof evidence.classification !== 'object') return false;
  const classification = evidence.classification as Record<string, unknown>;
  const hasBasis = (field: 'sector' | 'industry') =>
    typeof classification[field] === 'string' && Boolean((classification[field] as string).trim()) &&
    typeof classification[`${field}_source`] === 'string' && Boolean((classification[`${field}_source`] as string).trim());
  if (item.association_class === 'verified_peer') {
    const basis = classification.peer_basis;
    return (basis === 'sector' || basis === 'industry') && hasBasis(basis);
  }
  return hasBasis('sector') || hasBasis('industry');
}
