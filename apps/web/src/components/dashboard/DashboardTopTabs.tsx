'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDashboard } from '@/contexts/DashboardContext';
import { cn } from '@/lib/utils';

const PREFERRED_ORDER = [
  'overview',
  'financials',
  'technical analysis',
  'technical',
  'comparison analysis',
  'comparison',
  'ownership',
  'calendar',
];

function slugifyTab(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

export function DashboardTopTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeDashboard, activeTab, setActiveTab } = useDashboard();

  const tabs = useMemo(() => {
    if (!activeDashboard) return [];
    const sorted = [...activeDashboard.tabs].sort((a, b) => a.order - b.order);
    const orderMap = new Map(PREFERRED_ORDER.map((name, index) => [name, index]));

    return sorted.sort((a, b) => {
      const aKey = a.name.toLowerCase();
      const bKey = b.name.toLowerCase();
      const aRank = orderMap.get(aKey) ?? 999;
      const bRank = orderMap.get(bKey) ?? 999;
      if (aRank !== bRank) return aRank - bRank;
      return a.order - b.order;
    });
  }, [activeDashboard]);

  useEffect(() => {
    const param = searchParams?.get('tab');
    if (!param || !tabs.length) return;
    const match = tabs.find((tab) => slugifyTab(tab.name) === param.toLowerCase());
    if (match && match.id !== activeTab?.id) {
      setActiveTab(match.id);
    }
  }, [searchParams, tabs, activeTab, setActiveTab]);

  if (!tabs.length) return null;

  return (
    <div className="border-b border-[#1e2a3b] bg-[#0b1021]/70 backdrop-blur">
      <div className="flex items-center gap-1 px-3 h-10">
        {tabs.map((tab) => {
          const isActive = activeTab?.id === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                const slug = slugifyTab(tab.name);
                router.replace(`/dashboard?tab=${slug}`);
              }}
              className={cn(
                'px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition-colors',
                isActive
                  ? 'bg-white/10 text-white border border-white/10'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              {tab.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default DashboardTopTabs;
