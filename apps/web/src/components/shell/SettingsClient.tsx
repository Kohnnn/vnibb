'use client';

import React, { useEffect } from 'react';
import { ArrowLeft, Database, HardDrive, RotateCcw, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDataSources, type VnstockSource } from '@/contexts/DataSourcesContext';
import { Button } from '@/components/ui/button';
import { DataSourcesHealthPanel } from '@/components/settings/DataSourcesHealthPanel';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { resetDashboardWalkthroughPreference } from '@/lib/userPreferences';

const VNSTOCK_SOURCES: { value: VnstockSource; label: string; description: string }[] = [
  { value: 'VCI', label: 'VCI (Vietcap)', description: 'Free secondary provider; Vietcap IQ is the primary source' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();

  useEffect(() => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.settingsOpened, {
      source: 'settings_page',
      active_tab: 'page',
    });
  }, []);

  const handleRestartWalkthrough = () => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.walkthroughRestartRequested, {
      source: 'settings_page',
    });
    resetDashboardWalkthroughPreference();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-4 text-[var(--text-primary)] md:p-8">
      <main className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <Settings className="text-blue-500" />
            Settings
          </h1>
        </header>

        <div className="space-y-6">
          <section className="border-y border-[var(--border-subtle)] py-5">
            <div className="flex gap-3">
              <HardDrive size={18} className="mt-0.5 shrink-0 text-blue-400" />
              <div>
                <h2 className="text-sm font-semibold">Saved on this device</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  Settings, layouts, holdings, and Investment Theses stay in this browser. Saved layouts can be exported from the template selector.
                </p>
              </div>
            </div>
          </section>

          <section className="border-b border-[var(--border-subtle)] pb-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <RotateCcw size={16} className="text-blue-500" />
                  Walkthrough
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Replay the quick VNIBB tour from the dashboard.</p>
              </div>
              <Button type="button" onClick={handleRestartWalkthrough} className="gap-2 bg-blue-600 text-white hover:bg-blue-500">
                <RotateCcw size={16} />
                Restart Walkthrough
              </Button>
            </div>
          </section>

          <section>
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Database size={16} className="text-emerald-500" />
                vnstock Provider
              </h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">The backend uses Vietcap IQ first and free VCI only. Previous provider selections are migrated to VCI.</p>
            </div>
            <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
              {VNSTOCK_SOURCES.map((source) => (
                <button
                  key={source.value}
                  onClick={() => {
                    captureAnalyticsEvent(ANALYTICS_EVENTS.dataSourceChanged, {
                      previous_source: preferredVnstockSource,
                      source: source.value,
                    });
                    setPreferredVnstockSource(source.value);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-1 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">{source.label}</span>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">{source.description}</span>
                  </span>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${preferredVnstockSource === source.value ? 'bg-blue-500' : 'border border-[var(--border-color)]'}`} />
                </button>
              ))}
            </div>
          </section>

          <section>
            <DataSourcesHealthPanel />
          </section>
        </div>
      </main>
    </div>
  );
}
