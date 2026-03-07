'use client';

/**
 * Theme Provider with localStorage persistence.
 * 
 * Features:
 * - Dark/light mode toggle
 * - localStorage persistence
 * - No flash on page load
 * - Dark-first theme initialization
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'dark' | 'light';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'vnibb-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  // Get resolved theme
  const getResolvedTheme = (theme: Theme): 'dark' | 'light' => {
    return theme;
  };

  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');

  // Load theme from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      const initialTheme: Theme = stored === 'light' ? 'light' : 'dark';
      setThemeState(initialTheme);
      setResolvedTheme(getResolvedTheme(initialTheme));
      setMounted(true);
    } catch (error) {
      console.error('Failed to load theme from localStorage:', error);
      setMounted(true);
    }
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    const resolved = getResolvedTheme(theme);
    root.classList.add('theme-switching');

    // Remove both classes first
    root.classList.remove('light', 'dark');
    
    // Add the resolved theme
    root.classList.add(resolved);
    root.setAttribute('data-theme', resolved);
    
    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        resolved === 'dark' ? '#000000' : '#ffffff'
      );
    }

    setResolvedTheme(resolved);

    const transitionResetTimer = window.setTimeout(() => {
      root.classList.remove('theme-switching');
    }, 140);

    return () => {
      window.clearTimeout(transitionResetTimer);
      root.classList.remove('theme-switching');
    };
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      setThemeState(newTheme);
    } catch (error) {
      console.error('Failed to save theme to localStorage:', error);
      setThemeState(newTheme);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Script to inject before React hydration to prevent flash.
 * Add this to your root layout or _document.
 */
export const ThemeScript = () => {
  const script = `
    (function() {
      try {
        var theme = localStorage.getItem('${THEME_STORAGE_KEY}') || 'dark';
        var resolved = theme === 'light' ? 'light' : 'dark';
        
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(resolved);
        document.documentElement.setAttribute('data-theme', resolved);
      } catch (e) {
        console.error('Theme initialization error:', e);
      }
    })();
  `;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
};
