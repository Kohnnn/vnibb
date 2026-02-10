'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Globe, Plus, Trash2 } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';

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

const SITES_KEY = 'vnibb_research_sites';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

export function ResearchBrowserWidget({ id, symbol, onRemove }: ResearchBrowserWidgetProps) {
  const [sites, setSites] = useLocalStorage<SavedSite[]>(SITES_KEY, []);
  const [activeSiteId, setActiveSiteId] = useLocalStorage<string | null>(
    `vnibb_research_browser_active_${id}`,
    null
  );
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [activeSourceId, setActiveSourceId] = useState<string | null>('google');

  const activeSite = useMemo(() => {
    if (activeSourceId) return null;
    if (activeSiteId) {
      return sites.find((site) => site.id === activeSiteId) || null;
    }
    return sites[0] || null;
  }, [activeSiteId, activeSourceId, sites]);

  const quickSources = useMemo(() => {
    if (!symbol) return [];
    const query = `${symbol} cổ phiếu phân tích chứng khoán Việt Nam`;
    return [
      {
        id: 'google',
        label: 'Google',
        url: `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}`,
      },
      {
        id: 'vietstock',
        label: 'Vietstock',
        url: `https://vietstock.vn/search/?q=${encodeURIComponent(symbol)}`,
      },
      {
        id: 'cafef',
        label: 'CafeF',
        url: `https://search.cafef.vn/tim-kiem.chn?keywords=${encodeURIComponent(symbol)}`,
      },
      {
        id: 'tradingview',
        label: 'TradingView',
        url: `https://www.tradingview.com/symbols/HOSE-${encodeURIComponent(symbol)}/`,
      },
      {
        id: 'ndh',
        label: 'NDH',
        url: `https://ndh.vn/tim-kiem?q=${encodeURIComponent(symbol)}`,
      },
    ];
  }, [symbol]);

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
    if (!symbol) {
      setActiveSourceId(null);
      return;
    }
    setActiveSiteId(null);
    setActiveSourceId('google');
  }, [symbol, setActiveSiteId]);

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
    setActiveSourceId(sourceId);
    setActiveSiteId(null);
  };

  const activeUrl = activeSite?.url || activeSource?.url || '';
  const activeTitle = activeSite?.title || activeSource?.label || activeUrl;
  const canEmbed = Boolean(activeUrl);

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
            note={symbol ? `Researching ${symbol} • Embedded iframe` : 'Local storage • Embedded iframe'}
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
                <div className="absolute top-2 right-2 z-10">
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
                />
              </>
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
