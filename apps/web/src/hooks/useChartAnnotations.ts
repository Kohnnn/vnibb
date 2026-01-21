'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChartAnnotation } from '@/types/annotations';

const STORAGE_KEY = 'vnibb_chart_annotations_v1';

export function useChartAnnotations(symbol: string) {
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [selectedTool, setSelectedTool] = useState<'select' | 'horizontal' | 'trend' | 'text'>('select');
  const [activeColor, setActiveColor] = useState('#3b82f6');
  const [isDrawing, setIsDrawing] = useState(false);

  // Load annotations from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const all: any[] = JSON.parse(saved);
        setAnnotations(all.filter(a => a.symbol === symbol) as ChartAnnotation[]);
      } catch (e) {
        console.error('Failed to parse annotations', e);
      }
    }
  }, [symbol]);

  // Save all annotations to localStorage
  const saveToStorage = useCallback((newAnnotations: ChartAnnotation[]) => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const all: ChartAnnotation[] = saved ? JSON.parse(saved) : [];
    
    // Remove old annotations for this symbol, add new ones
    const filtered = all.filter(a => a.symbol !== symbol);
    const combined = [...filtered, ...newAnnotations];
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(combined));
  }, [symbol]);

  const addAnnotation = useCallback((annotation: any) => {
    const newAnnotation = {
      ...annotation,
      id: `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      createdAt: Date.now(),
    } as ChartAnnotation;

    const updated = [...annotations, newAnnotation];
    setAnnotations(updated);
    saveToStorage(updated);
    
    return newAnnotation;
  }, [annotations, symbol, saveToStorage]);

  const removeAnnotation = useCallback((annotationId: string) => {
    const updated = annotations.filter(a => a.id !== annotationId) as ChartAnnotation[];
    setAnnotations(updated);
    saveToStorage(updated);
  }, [annotations, saveToStorage]);

  const clearAllAnnotations = useCallback(() => {
    setAnnotations([]);
    saveToStorage([]);
  }, [saveToStorage]);

  const updateAnnotation = useCallback((annotationId: string, updates: Partial<ChartAnnotation>) => {
    const updated = annotations.map(a => 
      a.id === annotationId ? { ...a, ...updates } : a
    ) as ChartAnnotation[];
    setAnnotations(updated);
    saveToStorage(updated);
  }, [annotations, saveToStorage]);

  return {
    annotations,
    selectedTool,
    setSelectedTool,
    activeColor,
    setActiveColor,
    isDrawing,
    setIsDrawing,
    addAnnotation,
    removeAnnotation,
    clearAllAnnotations,
    updateAnnotation,
  };
}
