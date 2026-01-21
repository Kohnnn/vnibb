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

export default function SettingsPage() {
  const router = useRouter();
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000');

  const VNSTOCK_SOURCES: { value: VnstockSource; label: string; description: string }[] = [
    { value: 'KBS', label: 'KBS (Korea)', description: 'Recommended - New default in vnstock 3.4.0' },
    { value: 'VCI', label: 'VCI (Vietcap)', description: 'Most stable, comprehensive coverage' },
    { value: 'TCBS', label: 'TCBS', description: 'Premium features (may have upstream issues)' },
    { value: 'DNSE', label: 'DNSE', description: 'Good historical data, minute-level resolution' },
  ];

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.back()}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
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
            <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
              <Database size={18} />
              Data Source
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
              <Globe size={18} />
              Backend
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
              <Shield size={18} />
              Security
            </button>
          </aside>

          {/* Content */}
          <main className="md:col-span-3 space-y-8">
            {/* Appearance Section */}
            <section className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#222] bg-[#0d0d0d]">
                <h2 className="font-semibold flex items-center gap-2">
                  <Palette size={18} className="text-blue-500" />
                  Appearance
                </h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">Dark Mode</h3>
                    <p className="text-xs text-gray-500">Enable high-contrast dark theme</p>
                  </div>
                  <div className="w-12 h-6 bg-blue-600 rounded-full flex items-center px-1">
                    <div className="w-4 h-4 bg-white rounded-full ml-auto" />
                  </div>
                </div>
              </div>
            </section>

            {/* Data Source Section */}
            <section className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#222] bg-[#0d0d0d]">
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
                        : 'bg-black/40 border-[#222] hover:border-[#333]'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-sm font-bold ${preferredVnstockSource === source.value ? 'text-blue-400' : 'text-white'}`}>
                        {source.label}
                      </span>
                      {preferredVnstockSource === source.value && (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <span className="text-xs text-gray-500 mt-1">{source.description}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Backend Section */}
            <section className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#222] bg-[#0d0d0d]">
                <h2 className="font-semibold flex items-center gap-2">
                  <Globe size={18} className="text-purple-500" />
                  Backend API
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">API Endpoint</label>
                  <input 
                    type="text" 
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    className="w-full bg-black border border-[#222] focus:border-blue-500 outline-none rounded-lg px-4 py-2 text-sm font-mono"
                    placeholder="http://localhost:8000"
                  />
                  <p className="text-[10px] text-gray-500 italic">
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
