'use client';

import { useEffect, useMemo, useState } from 'react';

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
  const [sourceIndex, setSourceIndex] = useState(0);

  const domain = useMemo(() => {
    return normalizeDomain(website);
  }, [website]);

  const sources = useMemo(() => {
    if (!domain) return [];
    return [
      `https://logo.clearbit.com/${domain}`,
      `https://api.faviconkit.com/${domain}/${Math.max(size, 16)}`,
      `https://www.google.com/s2/favicons?domain=${domain}&sz=${Math.max(size * 2, 32)}`,
    ];
  }, [domain, size]);

  useEffect(() => {
    setSourceIndex(0);
  }, [domain]);

  const initials = (name || symbol || '?').trim().charAt(0).toUpperCase();

  if (!domain || sourceIndex >= sources.length) {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[10px] font-black text-[var(--accent-blue)] ${className ?? ''}`.trim()}
        style={{ width: size, height: size }}
        title={name || symbol}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={sources[sourceIndex]}
      alt={name || symbol}
      width={size}
      height={size}
      className={`rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] object-cover ${className ?? ''}`.trim()}
      onError={() => setSourceIndex((current) => current + 1)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      title={name || symbol}
    />
  );
}

export default CompanyLogo;
