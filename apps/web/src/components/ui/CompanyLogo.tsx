'use client';

import { useMemo, useState } from 'react';

interface CompanyLogoProps {
  symbol: string;
  name?: string;
  website?: string | null;
  size?: number;
  className?: string;
}

function normalizeDomain(website?: string | null): string | null {
  if (!website) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

export function CompanyLogo({ symbol, name, website, size = 20, className }: CompanyLogoProps) {
  const [broken, setBroken] = useState(false);

  const domain = useMemo(() => {
    return normalizeDomain(website);
  }, [website]);

  const initials = (name || symbol || '?').trim().charAt(0).toUpperCase();

  if (broken || !domain) {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-full border border-white/10 bg-blue-600/20 text-[10px] font-black text-blue-200 ${className ?? ''}`.trim()}
        style={{ width: size, height: size }}
        title={name || symbol}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={name || symbol}
      width={size}
      height={size}
      className={`rounded-full border border-white/10 bg-[#0b1221] object-cover ${className ?? ''}`.trim()}
      onError={() => setBroken(true)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      title={name || symbol}
    />
  );
}

export default CompanyLogo;
