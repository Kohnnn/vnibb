'use client';

import { useState } from 'react';
import { X, Settings as SettingsIcon, Database, Bell, Palette, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDataSources, type VnstockSource } from '@/contexts/DataSourcesContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingTab = 'general' | 'data' | 'notifications' | 'appearance';

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingTab>('general');
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();
  
  if (!isOpen) return null;

  const tabs = [
    { id: 'general' as const, label: 'General', icon: SettingsIcon },
    { id: 'data' as const, label: 'Data Sources', icon: Database },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0a0a0a] rounded-xl border border-gray-700 w-full max-w-3xl max-h-[80vh] flex shadow-2xl overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 bg-gray-900 border-r border-gray-800 p-4 shrink-0 hidden md:block">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <SettingsIcon size={20} className="text-blue-500" />
            Settings
          </h2>
          <nav className="space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                  activeTab === tab.id 
                    ? "bg-blue-600/20 text-blue-400 font-bold" 
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#0a0a0a]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <h3 className="text-lg font-bold text-white">
              {tabs.find(t => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-6 text-left">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-[10px] text-gray-500">Default Ticker</h4>
                  <input 
                    type="text" 
                    defaultValue="VNM"
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-[10px] text-gray-500">Refresh Interval</h4>
                  <select className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-white outline-none">
                    <option value="10">10 seconds</option>
                    <option value="30">30 seconds</option>
                    <option value="60">1 minute</option>
                  </select>
                </div>
              </div>
            )}
            {activeTab === 'data' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-[10px] text-gray-500">vnstock Data Source</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {(['KBS', 'VCI', 'TCBS', 'DNSE'] as VnstockSource[]).map(src => (
                      <button
                        key={src}
                        onClick={() => setPreferredVnstockSource(src)}
                        className={cn(
                          "px-3 py-2 rounded-lg border text-sm transition-all",
                          preferredVnstockSource === src
                            ? "bg-blue-600/20 border-blue-500 text-blue-400 font-bold"
                            : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700"
                        )}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">KBS is the recommended default for vnstock 3.4.0+</p>
                </div>
              </div>
            )}
            {activeTab === 'notifications' && <div className="text-gray-500 text-sm">Notification settings coming soon.</div>}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-[10px] text-gray-500">Theme</h4>
                  <div className="flex gap-2">
                    <button className="px-4 py-2 bg-blue-600/20 border border-blue-500 rounded-lg text-blue-400 font-bold text-sm">Dark</button>
                    <button className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-gray-500 text-sm">Light (Locked)</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
