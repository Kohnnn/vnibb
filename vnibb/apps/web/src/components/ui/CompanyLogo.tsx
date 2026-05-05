'use client';

import { useEffect, useMemo, useState } from 'react';

const LOGO_CACHE_STORAGE_KEY = 'vnibb-logo-provider-cache';

type LogoSource = {
  id: 'faviconkit' | 'uplead' | 'google';
  url: string;
};

let cachedLogoProviders: Record<string, LogoSource['id']> | null = null;

function readCachedLogoProviders(): Record<string, LogoSource['id']> {
  if (cachedLogoProviders) {
    return cachedLogoProviders;
  }

  if (typeof window === 'undefined') {
    cachedLogoProviders = {};
    return cachedLogoProviders;
  }

  try {
    const raw = window.localStorage.getItem(LOGO_CACHE_STORAGE_KEY);
    cachedLogoProviders = raw ? (JSON.parse(raw) as Record<string, LogoSource['id']>) : {};
  } catch {
    cachedLogoProviders = {};
  }

  return cachedLogoProviders;
}

function persistLogoProvider(domain: string, providerId: LogoSource['id']) {
  if (!domain || typeof window === 'undefined') return;
  const nextCache = {
    ...readCachedLogoProviders(),
    [domain]: providerId,
  };
  cachedLogoProviders = nextCache;
  window.localStorage.setItem(LOGO_CACHE_STORAGE_KEY, JSON.stringify(nextCache));
}

function getCachedLogoProvider(domain: string | null): LogoSource['id'] | null {
  if (!domain) return null;
  return readCachedLogoProviders()[domain] || null;
}

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

function buildInitials(name?: string, symbol?: string): string {
  const label = String(name || symbol || '?').trim();
  if (!label) return '?';

  const words = label.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
  }

  return label.slice(0, 2).toUpperCase();
}

export function CompanyLogo({ symbol, name, website, size = 20, className }: CompanyLogoProps) {
  const [sourceIndex, setSourceIndex] = useState(0);

  const domain = useMemo(() => {
    return normalizeDomain(website);
  }, [website]);

  const sources = useMemo<LogoSource[]>(() => {
    if (!domain) return [];
    return [
      {
        id: 'faviconkit',
        url: `https://api.faviconkit.com/${domain}/${Math.max(size, 16)}`,
      },
      {
        id: 'uplead',
        url: `https://logo.uplead.com/${domain}`,
      },
      {
        id: 'google',
        url: `https://www.google.com/s2/favicons?domain=${domain}&sz=${Math.max(size * 2, 32)}`,
      },
    ];
  }, [domain, size]);

  useEffect(() => {
    const cachedProvider = getCachedLogoProvider(domain);
    if (!cachedProvider) {
      setSourceIndex(0);
      return;
    }

    const cachedIndex = sources.findIndex((source) => source.id === cachedProvider);
    setSourceIndex(cachedIndex >= 0 ? cachedIndex : 0);
  }, [domain, sources]);

  const initials = buildInitials(name, symbol);

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
      src={sources[sourceIndex].url}
      alt={name || symbol}
      width={size}
      height={size}
      className={`rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] object-cover ${className ?? ''}`.trim()}
      onError={() => setSourceIndex((current) => current + 1)}
      onLoad={() => {
        if (!domain || sourceIndex >= sources.length) return;
        persistLogoProvider(domain, sources[sourceIndex].id);
      }}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      title={name || symbol}
    />
  );
}

export default CompanyLogo;
