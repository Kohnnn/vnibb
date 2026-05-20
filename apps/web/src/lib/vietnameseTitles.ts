/**
 * Translation table for Vietnamese executive title abbreviations.
 *
 * vnstock returns Vietnamese position abbreviations (e.g. "CTHĐQT", "TVHĐQT",
 * "TGĐ") for officer/management widgets. Without translation these are
 * cryptic to non-Vietnamese-speaking users and unfriendly to international
 * traders. Render order in the widget is `<abbr> (<English>)`.
 *
 * The map covers the most common HOSE/HNX/UPCOM filings vocabulary; missing
 * abbreviations fall through and are rendered as-is (no parenthetical).
 */

const TITLE_DICTIONARY: Record<string, string> = {
  'CTHĐQT': 'Chairman of the Board',
  'PCT': 'Vice Chairman',
  'PCTHĐQT': 'Vice Chairman of the Board',
  'TVHĐQT': 'Board Member',
  'TVĐL': 'Independent Board Member',
  'TVĐLHĐQT': 'Independent Board Member',
  'HĐQT': 'Board of Directors',
  'TGĐ': 'CEO',
  'CEO': 'CEO',
  'PTGĐ': 'Deputy CEO',
  'GĐ': 'Director',
  'PGĐ': 'Deputy Director',
  'KTT': 'Chief Accountant',
  'GĐTC': 'CFO',
  'CFO': 'CFO',
  'TBKS': 'Head of Supervisory Board',
  'BKS': 'Supervisory Board',
  'TVBKS': 'Supervisory Board Member',
  'TKHĐQT': 'Board Secretary',
  'NCĐB': 'Authorised Representative',
  'NĐD': 'Authorised Representative',
  'NĐDPLDN': 'Legal Representative',
  'NĐDVPL': 'Legal Representative',
  'NCBTT': 'Information Disclosure Officer',
  'TVHĐQTĐL': 'Independent Board Member',
  'CTKS': 'Head of Supervisory Board',
  'TKDN': 'Company Secretary',
};

/**
 * Look up the canonical English meaning for a Vietnamese title abbreviation.
 * Match is case-insensitive on the abbreviation; punctuation/whitespace is
 * preserved otherwise.
 */
export function translateVietnameseTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  const direct = TITLE_DICTIONARY[upper];
  if (direct) return direct;

  // Some sources concatenate roles with `,` `/` `&` `.`. Try to translate
  // each fragment individually so combined titles like "TGĐ/TVHĐQT" become
  // "CEO / Board Member".
  const parts = trimmed.split(/[,/&\.\u3002]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const translated = parts
      .map((part) => TITLE_DICTIONARY[part.toUpperCase()] || part)
      .join(' / ');
    if (translated !== trimmed) {
      return translated;
    }
  }

  return null;
}

/**
 * Renders the position string with the English meaning inline. If the title
 * is unknown, returns the original string. Used for tooltip-friendly display
 * across officer / management widgets.
 */
export function formatVietnameseTitle(raw: string | null | undefined): string {
  if (!raw) return '—';
  const trimmed = String(raw).trim();
  if (!trimmed) return '—';
  const english = translateVietnameseTitle(trimmed);
  if (!english) return trimmed;
  if (english.toLowerCase() === trimmed.toLowerCase()) return trimmed;
  return `${trimmed} (${english})`;
}
