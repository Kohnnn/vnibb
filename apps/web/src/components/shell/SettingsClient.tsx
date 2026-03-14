'use client';

import React, { useState } from 'react';
import { 
  Settings, 
  Database, 
  Palette, 
  Globe, 
  Shield, 
  Save,
  ArrowLeft
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDataSources, type VnstockSource } from '@/contexts/DataSourcesContext';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

export default function SettingsPage() {
  const router = useRouter();
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();
  const [apiUrl, setApiUrl] = useState(env.apiUrl);

  const VNSTOCK_SOURCES: { value: VnstockSource; label: string; description: string }[] = [
    { value: 'KBS', label: 'KBS (Korea)', description: 'Recommended - default in vnstock 3.5.0+' },
    { value: 'VCI', label: 'VCI (Vietcap)', description: 'Most stable, comprehensive coverage' },
    { value: 'DNSE', label: 'DNSE', description: 'Good historical data, minute-level resolution' },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-4 text-[var(--text-primary)] md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.back()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.back();
                }
              }}
              className="rounded-lg p-2 transition-colors hover:bg-[var(--bg-hover)]"
              aria-label="Go back"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Settings className="text-blue-500" />
              Settings
            </h1>
          </div>
          <Button variant="outline" className="gap-2 bg-blue-600 hover:bg-blue-500 border-none text-white">
            <Save size={16} />
            Save Changes
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Sidebar */}
          <aside className="md:col-span-1 space-y-1">
            <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-600/10 text-blue-400 font-medium">
              <Palette size={18} />
              Appearance
            </button>
            <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <Database size={18} />
              Data Source
            </button>
            <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <Globe size={18} />
              Backend
            </button>
            <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <Shield size={18} />
              Security
            </button>
          </aside>

          {/* Content */}
          <main className="md:col-span-3 space-y-8">
            {/* Appearance Section */}
            <section className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Palette size={18} className="text-blue-500" />
                  Appearance
                </h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">Dark Mode</h3>
                    <p className="text-xs text-[var(--text-muted)]">Enable high-contrast dark theme</p>
                  </div>
                  <div className="w-12 h-6 bg-blue-600 rounded-full flex items-center px-1">
                    <div className="w-4 h-4 bg-white rounded-full ml-auto" />
                  </div>
                </div>
              </div>
            </section>

            {/* Data Source Section */}
            <section className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Database size={18} className="text-emerald-500" />
                  vnstock Provider
                </h2>
              </div>
              <div className="p-6 space-y-4">
                {VNSTOCK_SOURCES.map((source) => (
                  <button
                    key={source.value}
                    onClick={() => setPreferredVnstockSource(source.value)}
                    className={`w-full flex flex-col items-start px-4 py-3 rounded-lg border text-left transition-all ${
                      preferredVnstockSource === source.value
                        ? 'bg-blue-600/10 border-blue-500/50 ring-1 ring-blue-500/20'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-color)] hover:border-[var(--border-default)]'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-sm font-bold ${preferredVnstockSource === source.value ? 'text-blue-400' : 'text-[var(--text-primary)]'}`}>
                        {source.label}
                      </span>
                      {preferredVnstockSource === source.value && (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <span className="mt-1 text-xs text-[var(--text-muted)]">{source.description}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Backend Section */}
            <section className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Globe size={18} className="text-cyan-500" />
                  Backend API
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="settings-api-endpoint"
                    className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
                  >
                    API Endpoint
                  </label>
                  <input 
                    id="settings-api-endpoint"
                    type="text" 
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-mono text-[var(--text-primary)] outline-none focus:border-blue-500"
                    placeholder="https://api.example.com"
                  />
                  <p className="text-[10px] italic text-[var(--text-muted)]">
                    Overrides the default environment variable. Requires page refresh.
                  </p>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
