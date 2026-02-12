'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Globe, Plus, Trash2 } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { useProfile } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';

interface ResearchBrowserWidgetProps {
  id: string;
  symbol?: string;
  onRemove?: () => void;
}

interface SavedSite {
  id: string;
  url: string;
  title?: string;
  createdAt: string;
  lastVisitedAt?: string;
}

interface QuickSource {
  id: string;
  label: string;
  url: string;
  preferredMode?: 'embed' | 'external';
}

const SITES_KEY = 'vnibb_research_sites';
const NON_EMBEDDABLE_HOSTS: Record<string, string> = {
  'google.com': 'Google blocks iframe embedding for search pages.',
  'tradingview.com': 'TradingView pages are designed to open directly in a browser tab.',
  'cafef.vn': 'CafeF blocks embedding in most contexts.',
  'ndh.vn': 'NDH blocks embedding in most contexts.',
};

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

function getHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getEmbedPolicy(url: string): { canEmbed: boolean; reason?: string; host?: string } {
  const host = getHost(url);
  if (!host) return { canEmbed: false, reason: 'Invalid URL' };

  const blocked = Object.entries(NON_EMBEDDABLE_HOSTS).find(([domain]) =>
    host === domain || host.endsWith(`.${domain}`)
  );
  if (!blocked) return { canEmbed: true, host };

  return {
    canEmbed: false,
    reason: blocked[1],
    host,
  };
}

export function ResearchBrowserWidget({ id, symbol, onRemove }: ResearchBrowserWidgetProps) {
  const [sites, setSites] = useLocalStorage<SavedSite[]>(SITES_KEY, []);
  const [activeSiteId, setActiveSiteId] = useLocalStorage<string | null>(
    `vnibb_research_browser_active_${id}`,
    null
  );
  const [activeSourceId, setActiveSourceId] = useLocalStorage<string | null>(
    `vnibb_research_source_${id}`,
    'vietstock'
  );
  const [viewMode, setViewMode] = useLocalStorage<'embed' | 'external'>(
    `vnibb_research_mode_${id}`,
    'embed'
  );
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [embedStatus, setEmbedStatus] = useState<'idle' | 'loading' | 'ready' | 'blocked'>('idle');
  const [history, setHistory] = useState<string[]>([]);
  const { data: profileData } = useProfile(symbol || '', Boolean(symbol));
  const symbolExchange = profileData?.data?.exchange?.trim().toUpperCase() || 'HOSE';

  const activeSite = useMemo(() => {
    if (activeSourceId) return null;
    if (activeSiteId) {
      return sites.find((site) => site.id === activeSiteId) || null;
    }
    return sites[0] || null;
  }, [activeSiteId, activeSourceId, sites]);

  const quickSources = useMemo<QuickSource[]>(() => {
    if (!symbol) return [];
    const normalizedSymbol = symbol.trim().toUpperCase();
    const tvSymbol = toTradingViewSymbol(normalizedSymbol, symbolExchange);
    const tvSlug = tvSymbol.includes(':') ? tvSymbol.replace(':', '-') : tvSymbol;
    const exchangeHint = ['HOSE', 'HSX', 'HNX', 'UPCOM'].includes(symbolExchange)
      ? symbolExchange === 'HSX'
        ? 'HOSE'
        : symbolExchange
      : 'VN';
    const query = `${normalizedSymbol} ${exchangeHint} cổ phiếu phân tích chứng khoán Việt Nam`;
    return [
      {
        id: 'google',
        label: 'Google',
        url: `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}`,
        preferredMode: 'external',
      },
      {
        id: 'vietstock',
        label: 'Vietstock',
        url: `https://vietstock.vn/tim-kiem.htm?keyword=${encodeURIComponent(normalizedSymbol)}`,
      },
      {
        id: 'cafef',
        label: 'CafeF',
        url: `https://search.cafef.vn/tim-kiem.chn?keywords=${encodeURIComponent(normalizedSymbol)}`,
        preferredMode: 'external',
      },
      {
        id: 'tradingview',
        label: 'TradingView',
        url: `https://www.tradingview.com/symbols/${encodeURIComponent(tvSlug)}/`,
        preferredMode: 'external',
      },
      {
        id: 'ndh',
        label: 'NDH',
        url: `https://ndh.vn/tim-kiem?q=${encodeURIComponent(normalizedSymbol)}`,
        preferredMode: 'external',
      },
    ];
  }, [symbol, symbolExchange]);

  const activeSource = useMemo(() => {
    if (!activeSourceId) return null;
    return quickSources.find((source) => source.id === activeSourceId) || null;
  }, [activeSourceId, quickSources]);

  useEffect(() => {
    if (!activeSiteId && sites.length > 0 && !activeSourceId) {
      setActiveSiteId(sites[0].id);
    }
  }, [activeSiteId, activeSourceId, setActiveSiteId, sites]);

  useEffect(() => {
    // Keep selected source sticky across ticker changes.
    // Only clear source mode if no ticker is available.
    if (!symbol && activeSourceId && quickSources.length === 0) {
      setActiveSourceId(null);
    }
  }, [symbol, activeSourceId, quickSources.length, setActiveSourceId]);

  useEffect(() => {
    if (!symbol || quickSources.length === 0) return;

    const selectedSource = quickSources.find((source) => source.id === activeSourceId);
    if (selectedSource) return;

    const preferred = quickSources.find((source) => source.preferredMode !== 'external') || quickSources[0];
    setActiveSourceId(preferred.id);
    if ((preferred.preferredMode || 'embed') === 'embed') {
      setViewMode('embed');
    }
  }, [symbol, quickSources, activeSourceId, setActiveSourceId, setViewMode]);

  const handleAddSite = () => {
    const normalized = normalizeUrl(urlInput);
    if (!normalized) return;

    const existing = sites.find((site) => site.url === normalized);
    if (existing) {
      setActiveSiteId(existing.id);
      setUrlInput('');
      setTitleInput('');
      return;
    }

    const newSite: SavedSite = {
      id: `${Date.now()}`,
      url: normalized,
      title: titleInput.trim() || normalized.replace(/^https?:\/\//, ''),
      createdAt: new Date().toISOString(),
      lastVisitedAt: new Date().toISOString(),
    };

    setSites((prev) => [newSite, ...prev]);
    setActiveSiteId(newSite.id);
    setActiveSourceId(null);
    setUrlInput('');
    setTitleInput('');
  };

  const handleSelectSite = (site: SavedSite) => {
    setActiveSiteId(site.id);
    setActiveSourceId(null);
    setViewMode('embed');
    setSites((prev) =>
      prev.map((item) =>
        item.id === site.id ? { ...item, lastVisitedAt: new Date().toISOString() } : item
      )
    );
  };

  const handleRemoveSite = (siteId: string) => {
    setSites((prev) => prev.filter((site) => site.id !== siteId));
    if (activeSiteId === siteId) {
      setActiveSiteId(null);
    }
  };

  const handleSelectQuickSource = (sourceId: string) => {
    const source = quickSources.find((item) => item.id === sourceId);
    setActiveSourceId(sourceId);
    setActiveSiteId(null);
    setViewMode(source?.preferredMode || 'embed');
  };

  const activeUrl = activeSite?.url || activeSource?.url || '';
  const activeTitle = activeSite?.title || activeSource?.label || activeUrl;
  const embedPolicy = useMemo(() => getEmbedPolicy(activeUrl), [activeUrl]);
  const canEmbed = Boolean(activeUrl) && viewMode === 'embed' && embedPolicy.canEmbed;

  useEffect(() => {
    if (!activeUrl) {
      setEmbedStatus('idle');
      return;
    }

    setHistory((prev) => {
      if (prev[prev.length - 1] === activeUrl) return prev;
      return [...prev.slice(-19), activeUrl];
    });

    if (viewMode !== 'embed') {
      setEmbedStatus('idle');
      return;
    }

    if (!embedPolicy.canEmbed) {
      setEmbedStatus('blocked');
      return;
    }

    setEmbedStatus('loading');
    const timeout = window.setTimeout(() => {
      setEmbedStatus((current) => (current === 'ready' ? current : 'blocked'));
    }, 9000);

    return () => window.clearTimeout(timeout);
  }, [activeUrl, viewMode, embedPolicy]);

  return (
    <WidgetContainer
      title="Research Browser"
      onClose={onRemove}
      noPadding
      widgetId={id}
    >
      <div className="h-full flex flex-col bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            note={
              symbol
                ? `Researching ${symbol} • ${viewMode === 'embed' ? 'Embed mode' : 'External mode'}`
                : 'Local storage'
            }
            align="right"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] h-full">
          <div className="border-b lg:border-b-0 lg:border-r border-gray-800/60 p-3 space-y-3">
            <div className="space-y-2">
              <input
                value={titleInput}
                onChange={(event) => setTitleInput(event.target.value)}
                placeholder="Site name (optional)"
                className="w-full rounded border border-gray-800/70 bg-black/20 px-2 py-1 text-xs text-gray-200"
              />
              <div className="flex gap-2">
                <input
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  placeholder="https://..."
                  className="flex-1 rounded border border-gray-800/70 bg-black/20 px-2 py-1 text-xs text-gray-200"
                />
                <button
                  type="button"
                  onClick={handleAddSite}
                  className="inline-flex items-center justify-center rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="text-[10px] text-gray-500">
                Some sites block embedding. Use the open button if the page stays blank.
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Quick Search
              </div>
              {symbol ? (
                <div className="grid grid-cols-2 gap-2">
                  {quickSources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => handleSelectQuickSource(source.id)}
                      className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                        activeSource?.id === source.id
                          ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                          : 'border-gray-800/60 bg-black/20 text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      {source.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-gray-500">Select a ticker to enable quick search.</div>
              )}
            </div>

            {sites.length === 0 ? (
              <WidgetEmpty message="Save a site to begin" icon={<Globe size={18} />} />
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">Saved Sites</div>
                {sites.map((site) => (
                  <div
                    key={site.id}
                    className={`flex items-center justify-between gap-2 rounded border px-2 py-2 text-left text-xs transition-colors ${
                      activeSite?.id === site.id
                        ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                        : 'border-gray-800/60 bg-black/20 text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSite(site)}
                      className="flex-1 text-left"
                    >
                      <div className="font-semibold line-clamp-1">{site.title || site.url}</div>
                      <div className="text-[10px] text-gray-500 line-clamp-1">
                        {site.url.replace(/^https?:\/\//, '')}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveSite(site.id)}
                      className="text-gray-500 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex-1 min-h-[320px]">
            {canEmbed ? (
              <>
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('external')}
                    className="inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[10px] text-gray-200 hover:text-white"
                  >
                    External mode
                  </button>
                  <a
                  href={activeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[10px] text-gray-200 hover:text-white"
                  >
                    <ExternalLink size={10} />
                    Open
                  </a>
                </div>
                <iframe
                  title={activeTitle || 'Research browser'}
                  src={activeUrl}
                  className="h-full w-full border-0"
                  loading="lazy"
                  onLoad={() => setEmbedStatus('ready')}
                />
                {embedStatus === 'loading' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 text-xs text-gray-300">
                    Loading embedded page...
                  </div>
                )}
                {embedStatus === 'blocked' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 p-4 text-center">
                    <div className="text-sm font-semibold text-white">This site may block embedding</div>
                    <div className="text-[11px] text-gray-300">
                      {embedPolicy.reason || 'Switch to external mode or open directly in a new tab.'}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewMode('external')}
                        className="rounded border border-blue-500/60 px-3 py-1 text-xs text-blue-200 hover:border-blue-300"
                      >
                        External mode
                      </button>
                      <a
                        href={activeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-gray-500/60 px-3 py-1 text-xs text-gray-100 hover:border-gray-300"
                      >
                        Open in new tab
                      </a>
                    </div>
                  </div>
                )}
              </>
            ) : viewMode === 'embed' && activeUrl && !embedPolicy.canEmbed ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                <div className="text-sm font-semibold text-white">Embed blocked for this source</div>
                <div className="text-[11px] text-gray-300">
                  {embedPolicy.reason || 'This website blocks iframe embedding.'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('external')}
                    className="rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 hover:border-blue-300"
                  >
                    Switch to external mode
                  </button>
                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-gray-500/60 px-3 py-1.5 text-xs text-gray-100 hover:border-gray-300"
                  >
                    Open in new tab
                  </a>
                </div>
              </div>
            ) : viewMode === 'external' && activeUrl ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                <div className="text-xs text-gray-300">External mode enabled for this source.</div>
                <div className="flex items-center gap-2">
                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 hover:border-blue-300"
                  >
                    <ExternalLink size={12} />
                    Open site
                  </a>
                  <button
                    type="button"
                    onClick={() => setViewMode('embed')}
                    className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:border-gray-300"
                  >
                    Try embed again
                  </button>
                </div>
                {history.length > 0 && (
                  <div className="max-w-full text-[10px] text-gray-500">
                    Last visited: {history[history.length - 1]}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <WidgetEmpty message="Select a saved site to embed" icon={<Globe size={18} />} />
              </div>
            )}
          </div>
        </div>
      </div>
    </WidgetContainer>
  );
}

export default ResearchBrowserWidget;
