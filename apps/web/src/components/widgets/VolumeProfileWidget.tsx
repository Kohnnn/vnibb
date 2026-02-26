'use client';

import { BarChart2 } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { calculateVolumeProfile, type OHLCData } from '@/lib/chartUtils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface VolumeProfileWidgetProps {
  symbol: string;
}

interface VolumeBin {
  price: number;
  volume: number;
}

function formatVolume(volume: number): string {
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(0)}K`;
  return Math.round(volume).toLocaleString();
}

function calculateValueArea(profile: VolumeBin[], targetShare = 0.7) {
  if (!profile.length) {
    return { pocPrice: null as number | null, vahPrice: null as number | null, valPrice: null as number | null };
  }

  const totalVolume = profile.reduce((sum, bin) => sum + bin.volume, 0);
  const targetVolume = totalVolume * targetShare;

  let pocIndex = 0;
  for (let i = 1; i < profile.length; i += 1) {
    if (profile[i].volume > profile[pocIndex].volume) {
      pocIndex = i;
    }
  }

  const included = new Set<number>([pocIndex]);
  let coveredVolume = profile[pocIndex].volume;
  let left = pocIndex - 1;
  let right = pocIndex + 1;

  while (coveredVolume < targetVolume && (left >= 0 || right < profile.length)) {
    const leftVolume = left >= 0 ? profile[left].volume : -1;
    const rightVolume = right < profile.length ? profile[right].volume : -1;

    if (leftVolume >= rightVolume && left >= 0) {
      included.add(left);
      coveredVolume += profile[left].volume;
      left -= 1;
    } else if (right < profile.length) {
      included.add(right);
      coveredVolume += profile[right].volume;
      right += 1;
    } else {
      break;
    }
  }

  const selected = [...included].sort((a, b) => a - b);
  const valPrice = profile[selected[0]]?.price ?? null;
  const vahPrice = profile[selected[selected.length - 1]]?.price ?? null;

  return {
    pocPrice: profile[pocIndex].price,
    vahPrice,
    valPrice,
  };
}

export function VolumeProfileWidget({ symbol }: VolumeProfileWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useHistoricalPrices(upperSymbol, {
    startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    enabled: Boolean(upperSymbol),
  });

  const candles = (data?.data || []) as OHLCData[];
  const profile = calculateVolumeProfile(candles, 24) as VolumeBin[];
  const hasData = profile.length > 0;
  const isFallback = Boolean(error && hasData);

  const maxVolume = profile.reduce((max, bin) => Math.max(max, bin.volume), 0);
  const { pocPrice, vahPrice, valPrice } = calculateValueArea(profile, 0.7);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view volume profile" icon={<BarChart2 size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <BarChart2 size={12} className="text-cyan-400" />
          <span>6M Volume Profile</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          note="24 bins"
          align="right"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="text-gray-500 uppercase tracking-widest">POC</div>
          <div className="text-cyan-300 font-mono">{pocPrice ? pocPrice.toFixed(2) : '-'}</div>
        </div>
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="text-gray-500 uppercase tracking-widest">VAH</div>
          <div className="text-emerald-300 font-mono">{vahPrice ? vahPrice.toFixed(2) : '-'}</div>
        </div>
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="text-gray-500 uppercase tracking-widest">VAL</div>
          <div className="text-amber-300 font-mono">{valPrice ? valPrice.toFixed(2) : '-'}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="No volume profile data" icon={<BarChart2 size={18} />} />
        ) : (
          profile
            .slice()
            .reverse()
            .map((bin, index) => {
              const widthPct = maxVolume > 0 ? (bin.volume / maxVolume) * 100 : 0;
              const isPOC = pocPrice !== null && Math.abs(bin.price - pocPrice) < Number.EPSILON;
              const isInValueArea =
                vahPrice !== null && valPrice !== null && bin.price >= valPrice && bin.price <= vahPrice;

              return (
                <div key={`${bin.price}-${index}`} className="flex items-center gap-2">
                  <div className="w-14 text-[10px] text-gray-500 shrink-0 font-mono">{bin.price.toFixed(2)}</div>
                  <div className="flex-1 h-4 bg-gray-800/30 rounded overflow-hidden relative">
                    <div
                      className={`h-full ${
                        isPOC
                          ? 'bg-cyan-500'
                          : isInValueArea
                            ? 'bg-emerald-500/70'
                            : 'bg-gray-500/45'
                      }`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <div className="w-12 text-[10px] text-gray-400 text-right shrink-0">{formatVolume(bin.volume)}</div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}

export default VolumeProfileWidget;
