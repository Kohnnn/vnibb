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
  return Array.isArray(terms) && terms.some(term =>
    term && (term.field === 'title' || term.field === 'body') && kinds.includes(term.kind || '')
  );
}
