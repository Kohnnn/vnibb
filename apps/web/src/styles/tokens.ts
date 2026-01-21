/**
 * VNIBB Design Tokens
 * Single source of truth for all design values
 */

export const tokens = {
  // Color Palette
  colors: {
    // Brand
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',  // Main blue
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
    },
    
    // Semantic Colors
    success: {
      light: '#4ade80',
      main: '#22c55e',
      dark: '#16a34a',
      bg: 'rgba(34, 197, 94, 0.1)',
    },
    
    danger: {
      light: '#f87171',
      main: '#ef4444',
      dark: '#dc2626',
      bg: 'rgba(239, 68, 68, 0.1)',
    },
    
    warning: {
      light: '#fbbf24',
      main: '#f59e0b',
      dark: '#d97706',
      bg: 'rgba(245, 158, 11, 0.1)',
    },
    
    // Neutral (Dark theme)
    neutral: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
      950: '#0a0e17',  // Darkest background
    },
    
    // Chart Colors
    chart: {
      green: '#22c55e',
      red: '#ef4444',
      blue: '#3b82f6',
      purple: '#8b5cf6',
      orange: '#f59e0b',
      pink: '#ec4899',
      cyan: '#06b6d4',
      lime: '#84cc16',
    },
  },
  
  // Spacing Scale (4px base)
  spacing: {
    px: '1px',
    0: '0',
    0.5: '0.125rem',  // 2px
    1: '0.25rem',     // 4px
    1.5: '0.375rem',  // 6px
    2: '0.5rem',      // 8px
    2.5: '0.625rem',  // 10px
    3: '0.75rem',     // 12px
    4: '1rem',        // 16px
    5: '1.25rem',     // 20px
    6: '1.5rem',      // 24px
    8: '2rem',        // 32px
    10: '2.5rem',     // 40px
    12: '3rem',       // 48px
    16: '4rem',       // 64px
  },
  
  // Typography
  typography: {
    fontFamily: {
      sans: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      mono: 'JetBrains Mono, Menlo, Monaco, monospace',
    },
    fontSize: {
      xs: ['0.75rem', { lineHeight: '1rem' }],      // 12px
      sm: ['0.875rem', { lineHeight: '1.25rem' }],  // 14px
      base: ['1rem', { lineHeight: '1.5rem' }],     // 16px
      lg: ['1.125rem', { lineHeight: '1.75rem' }],  // 18px
      xl: ['1.25rem', { lineHeight: '1.75rem' }],   // 20px
      '2xl': ['1.5rem', { lineHeight: '2rem' }],    // 24px
    },
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  
  // Border Radius
  radius: {
    none: '0',
    sm: '0.125rem',   // 2px
    DEFAULT: '0.25rem', // 4px
    md: '0.375rem',   // 6px
    lg: '0.5rem',     // 8px
    xl: '0.75rem',    // 12px
    '2xl': '1rem',    // 16px
    full: '9999px',
  },
  
  // Shadows (for glassmorphism)
  shadow: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    glow: '0 0 20px rgba(59, 130, 246, 0.3)',
  },
  
  // Widget-specific
  widget: {
    headerHeight: '40px',
    padding: '12px',
    borderColor: 'rgba(75, 85, 99, 0.5)',
    bgPrimary: 'rgba(17, 24, 39, 0.9)',
    bgSecondary: 'rgba(31, 41, 55, 0.5)',
  },
} as const;

// Type exports
export type ColorToken = keyof typeof tokens.colors;
export type SpacingToken = keyof typeof tokens.spacing;
