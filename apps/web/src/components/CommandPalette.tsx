'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Command } from 'cmdk';
import { 
  Search, Plus, LayoutGrid, Settings, Moon, Sun, 
  RefreshCw, Download, Maximize2, Home, BarChart2,
  TrendingUp, PieChart, Newspaper, Bell, Database,
  Globe, User, Box, FileText, ChevronRight, X
} from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { widgetNames } from '@/components/widgets/WidgetRegistry';
import type { WidgetType } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useDataSources } from '@/contexts/DataSourcesContext';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  category: 'navigation' | 'widgets' | 'actions' | 'settings';
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const { 
    state,
    setActiveDashboard,
    addWidget,
  } = useDashboard();
  const { setGlobalSymbol } = useWidgetGroups();
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();

  // Toggle the menu when ⌘K or Ctrl+K is pressed - handled in layout now, but keeping for standalone robustness
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  // Build command list
  const commands = useMemo((): CommandItem[] => [
    // Navigation
    {
      id: 'home',
      label: 'Go to Home Dashboard',
      icon: <Home className="w-4 h-4" />,
      shortcut: '⌘H',
      action: () => {
        const homeDashboard = state.dashboards.find(d => d.isDefault);
        if (homeDashboard) setActiveDashboard(homeDashboard.id);
        onOpenChange(false);
      },
      category: 'navigation',
    },
    ...state.dashboards.map(d => ({
      id: `dashboard-${d.id}`,
      label: `Switch to: ${d.name}`,
      icon: <LayoutGrid className="w-4 h-4" />,
      action: () => {
        setActiveDashboard(d.id);
        onOpenChange(false);
      },
      category: 'navigation' as const,
    })),
    
    // Widget commands
    ...Object.entries(widgetNames).map(([type, name]) => ({
      id: `add-widget-${type}`,
      label: `Add Widget: ${name}`,
      icon: getWidgetIcon(type as WidgetType),
      action: () => {
        if (state.activeDashboardId && state.activeTabId) {
            addWidget(state.activeDashboardId, state.activeTabId, {
                type: type as WidgetType,
                tabId: state.activeTabId,
                layout: { x: 0, y: 0, w: 4, h: 4 }
            });
        }
        onOpenChange(false);
      },
      category: 'widgets' as const,
    })),

    // Data Sources
    {
        id: 'source-kbs',
        label: 'Set Data Source: KBS (Recommended)',
        icon: <Database className="w-4 h-4" />,
        action: () => {
            setPreferredVnstockSource('KBS');
            onOpenChange(false);
        },
        category: 'settings',
    },
    {
        id: 'source-vci',
        label: 'Set Data Source: VCI',
        icon: <Database className="w-4 h-4" />,
        action: () => {
            setPreferredVnstockSource('VCI');
            onOpenChange(false);
        },
        category: 'settings',
    },

    // Actions
    {
      id: 'refresh-all',
      label: 'Refresh All Data',
      icon: <RefreshCw className="w-4 h-4" />,
      shortcut: '⌘R',
      action: () => {
        window.location.reload();
        onOpenChange(false);
      },
      category: 'actions',
    },
    {
        id: 'search-ticker',
        label: search ? `Search Ticker: ${search.toUpperCase()}` : 'Type ticker symbol...',
        icon: <Search className="w-4 h-4" />,
        action: () => {
          if (search.length >= 2) {
             setGlobalSymbol(search.toUpperCase());
          }
          onOpenChange(false);
        },
        category: 'navigation',
    },

    // Settings
    {
      id: 'settings',
      label: 'Open Global Settings',
      icon: <Settings className="w-4 h-4" />,
      shortcut: '⌘,',
      action: () => {
        window.dispatchEvent(new CustomEvent('open-settings'));
        onOpenChange(false);
      },
      category: 'settings',
    },
  ], [state.dashboards, state.activeDashboardId, state.activeTabId, setActiveDashboard, addWidget, onOpenChange, search, setPreferredVnstockSource]);

  // Filter commands based on search
  const filteredCommands = useMemo(() => 
    commands.filter(cmd =>
      cmd.label.toLowerCase().includes(search.toLowerCase())
    ),
    [commands, search]
  );

  const groupedCommands = useMemo(() => ({
    navigation: filteredCommands.filter(c => c.category === 'navigation'),
    widgets: filteredCommands.filter(c => c.category === 'widgets'),
    actions: filteredCommands.filter(c => c.category === 'actions'),
    settings: filteredCommands.filter(c => c.category === 'settings'),
  }), [filteredCommands]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="w-full max-w-xl bg-[#0a0a0a] border border-gray-800 rounded-xl shadow-2xl overflow-hidden"
          >
            <Command className="flex flex-col h-full">
              <div className="flex items-center gap-3 px-4 border-b border-gray-800">
                <Search className="w-5 h-5 text-gray-500" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Type a command or search..."
                  className="flex-1 h-12 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                  autoFocus
                />
                <button onClick={() => onOpenChange(false)} className="p-1 text-gray-500 hover:text-white rounded">
                    <X size={16} />
                </button>
              </div>

              <Command.List className="max-h-[400px] overflow-y-auto p-2 scrollbar-hide">
                <Command.Empty className="py-10 text-center text-gray-500 text-sm">
                    <Box className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    No results found for "{search}"
                </Command.Empty>

                {groupedCommands.navigation.length > 0 && (
                  <Command.Group heading="Navigation" className="mb-2">
                    <div className="px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      Navigation
                    </div>
                    {groupedCommands.navigation.map(cmd => (
                      <CommandItem key={cmd.id} command={cmd} />
                    ))}
                  </Command.Group>
                )}

                {groupedCommands.widgets.length > 0 && (
                  <Command.Group heading="Add Widget" className="mb-2">
                    <div className="px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      Add Widget
                    </div>
                    {groupedCommands.widgets.slice(0, 8).map(cmd => (
                      <CommandItem key={cmd.id} command={cmd} />
                    ))}
                    {groupedCommands.widgets.length > 8 && (
                       <div className="px-3 py-1.5 text-[10px] text-gray-600 italic">
                         +{groupedCommands.widgets.length - 8} more widgets...
                       </div>
                    )}
                  </Command.Group>
                )}

                {groupedCommands.actions.length > 0 && (
                  <Command.Group heading="Actions" className="mb-2">
                    <div className="px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      Actions
                    </div>
                    {groupedCommands.actions.map(cmd => (
                      <CommandItem key={cmd.id} command={cmd} />
                    ))}
                  </Command.Group>
                )}

                {groupedCommands.settings.length > 0 && (
                  <Command.Group heading="Settings">
                    <div className="px-2 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      Settings
                    </div>
                    {groupedCommands.settings.map(cmd => (
                      <CommandItem key={cmd.id} command={cmd} />
                    ))}
                  </Command.Group>
                )}
              </Command.List>
              
              <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/30 flex items-center justify-between text-[10px] text-gray-500">
                 <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-gray-800 rounded">↑↓</kbd> <span>Navigate</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-gray-800 rounded">↵</kbd> <span>Select</span>
                    </div>
                 </div>
                 <div className="font-mono">
                    VNIBB Terminal
                 </div>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function CommandItem({ command }: { command: CommandItem }) {
  return (
    <Command.Item
      onSelect={command.action}
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-gray-400 aria-selected:bg-blue-600/10 aria-selected:text-blue-400 transition-colors group"
    >
      <div className="w-8 h-8 rounded bg-gray-900 border border-gray-800 flex items-center justify-center group-aria-selected:border-blue-500/30">
        {command.icon}
      </div>
      <span className="flex-1 text-sm font-medium">{command.label}</span>
      {command.shortcut && (
        <kbd className="px-1.5 py-0.5 text-[10px] text-gray-600 bg-gray-950 border border-gray-800 rounded font-sans">
          {command.shortcut}
        </kbd>
      )}
      <ChevronRight className="w-3 h-3 opacity-0 group-aria-selected:opacity-100 transition-opacity" />
    </Command.Item>
  );
}

function getWidgetIcon(type: WidgetType): React.ReactNode {
  const iconMap: Partial<Record<WidgetType, React.ReactNode>> = {
    price_chart: <BarChart2 className="w-4 h-4" />,
    screener: <Database className="w-4 h-4" />,
    news_feed: <Newspaper className="w-4 h-4" />,
    top_movers: <TrendingUp className="w-4 h-4" />,
    sector_performance: <PieChart className="w-4 h-4" />,
    price_alerts: <Bell className="w-4 h-4" />,
    ticker_info: <User className="w-4 h-4" />,
    financials: <FileText className="w-4 h-4" />,
  };
  return iconMap[type] || <Plus className="w-4 h-4" />;
}
