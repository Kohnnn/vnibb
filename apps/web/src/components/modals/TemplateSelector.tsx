'use client';

import { memo, useState } from 'react';
import { X, Layout, TrendingUp, Search, Newspaper, Box, ChevronRight } from 'lucide-react';
import { DASHBOARD_TEMPLATES, DashboardTemplate } from '@/types/dashboard-templates';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: DashboardTemplate) => void;
}

const CATEGORY_ICONS: Record<string, any> = {
  trading: TrendingUp,
  analysis: Search,
  research: Layout,
  overview: Newspaper,
};

function TemplateSelectorComponent({ open, onClose, onSelectTemplate }: TemplateSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (!open) return null;

  const filteredTemplates = selectedCategory
    ? DASHBOARD_TEMPLATES.filter(t => t.category === selectedCategory)
    : DASHBOARD_TEMPLATES;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-4xl max-h-[85vh] bg-[#0a0a0a] border border-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800 bg-[#0d0d0d]">
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
                <Layout className="text-blue-500" size={20} />
                Dashboard Templates
            </h2>
            <p className="text-xs text-gray-500 font-medium">Quickly setup your workspace with professional layouts</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 p-4 border-b border-gray-800 bg-black/40">
          <button
            onClick={() => setSelectedCategory(null)}
            className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                !selectedCategory ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-gray-500 hover:text-gray-300 bg-gray-900'
            )}
          >
            All Templates
          </button>
          {Object.entries(CATEGORY_ICONS).map(([cat, Icon]) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                selectedCategory === cat ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-gray-500 hover:text-gray-300 bg-gray-900'
              )}
            >
              <Icon className="w-3 h-3" />
              {cat}
            </button>
          ))}
        </div>

        {/* Templates Grid */}
        <div className="flex-1 p-6 overflow-y-auto scrollbar-hide bg-black/20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => {
                  onSelectTemplate(template);
                  onClose();
                }}
                className="group flex flex-col text-left transition-all duration-300 focus:outline-none"
              >
                {/* Thumbnail Placeholder */}
                <div className="aspect-video w-full mb-3 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center relative overflow-hidden group-hover:border-blue-500/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] transition-all">
                  <Box className="w-12 h-12 text-gray-800 group-hover:text-blue-500/30 transition-colors" strokeWidth={1} />
                  
                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors flex items-center justify-center">
                    <div className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all">
                        Apply Template
                    </div>
                  </div>
                </div>
                
                <h3 className="font-bold text-white text-sm group-hover:text-blue-400 transition-colors">{template.name}</h3>
                <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                    {template.description}
                </p>
                
                <div className="mt-auto pt-3 flex items-center justify-between border-t border-gray-800/50">
                    <span className="text-[9px] font-black text-gray-600 uppercase tracking-tighter">
                      {template.widgets.length} Components
                    </span>
                    <ChevronRight size={14} className="text-gray-700 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export const TemplateSelector = memo(TemplateSelectorComponent);
export default TemplateSelector;
