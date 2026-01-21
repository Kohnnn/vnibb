'use client';

import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_PRESETS, type ColumnPreset } from '@/types/screener';

const STORAGE_KEY = 'vnibb_screener_presets_v2';
const ACTIVE_PRESET_KEY = 'vnibb_screener_active_preset_v2';

export function useColumnPresets() {
  const [presets, setPresets] = useState<ColumnPreset[]>(DEFAULT_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string>('overview');
  const [customColumns, setCustomColumns] = useState<string[] | null>(null);

  // Load from localStorage
  useEffect(() => {
    const savedPresets = localStorage.getItem(STORAGE_KEY);
    const savedActivePreset = localStorage.getItem(ACTIVE_PRESET_KEY);
    
    if (savedPresets) {
      try {
        const parsed = JSON.parse(savedPresets);
        setPresets([...DEFAULT_PRESETS, ...parsed.filter((p: ColumnPreset) => p.isCustom)]);
      } catch (e) {
        console.error('Failed to parse saved presets', e);
      }
    }
    
    if (savedActivePreset) {
      setActivePresetId(savedActivePreset);
    }
  }, []);

  // Save to localStorage
  const savePreset = useCallback((preset: ColumnPreset) => {
    const customPresets = presets.filter(p => p.isCustom);
    const existing = customPresets.findIndex(p => p.id === preset.id);
    
    if (existing >= 0) {
      customPresets[existing] = preset;
    } else {
      customPresets.push({ ...preset, isCustom: true });
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
    setPresets([...DEFAULT_PRESETS, ...customPresets]);
  }, [presets]);

  const selectPreset = useCallback((presetId: string) => {
    setActivePresetId(presetId);
    setCustomColumns(null);
    localStorage.setItem(ACTIVE_PRESET_KEY, presetId);
  }, []);

  const getActiveColumns = useCallback((): string[] => {
    if (customColumns) return customColumns;
    const preset = presets.find(p => p.id === activePresetId);
    return preset?.columns || DEFAULT_PRESETS[0].columns;
  }, [presets, activePresetId, customColumns]);

  const setColumns = useCallback((columns: string[]) => {
    setCustomColumns(columns);
  }, []);

  return {
    presets,
    activePresetId,
    selectPreset,
    savePreset,
    getActiveColumns,
    setColumns,
  };
}
