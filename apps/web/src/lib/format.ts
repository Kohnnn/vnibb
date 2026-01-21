/**
 * Shared Utility Functions for Formatting and Common Operations
 * 
 * Centralized formatting utilities to ensure consistency across the app.
 * This module extends the existing formatters.ts with additional utilities.
 */

/**
 * Format currency with locale support
 */
export function formatCurrency(
  value: number | null | undefined,
  locale: string = 'vi-VN',
  currency: string = 'VND'
): string {
  if (value === null || value === undefined || isNaN(value)) return '-';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Fallback if Intl fails
    return `${value.toLocaleString()} ${currency}`;
  }
}

/**
 * Format percentage with customizable options
 */
export function formatPercent(
  value: number | null | undefined,
  decimals: number = 2,
  showSign: boolean = true
): string {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const percent = value * 100;
  const sign = showSign && percent > 0 ? '+' : '';

  return `${sign}${percent.toFixed(decimals)}%`;
}

/**
 * Format number with locale and precision
 */
export function formatNumber(
  value: number | null | undefined,
  decimals: number = 0,
  locale: string = 'en-US'
): string {
  if (value === null || value === undefined || isNaN(value)) return '-';

  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format compact numbers (K, M, B, T)
 */
export function formatCompact(
  value: number | null | undefined,
  decimals: number = 1
): string {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  const units = [
    { threshold: 1e12, suffix: 'T' },
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e3, suffix: 'K' },
  ];

  for (const { threshold, suffix } of units) {
    if (abs >= threshold) {
      return `${sign}${(abs / threshold).toFixed(decimals)}${suffix}`;
    }
  }

  return `${sign}${abs.toFixed(decimals)}`;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

/**
 * Format date to localized string
 */
export function formatDate(
  date: Date | string,
  format: 'short' | 'medium' | 'long' | 'full' = 'medium',
  locale: string = 'en-US'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const formatOptions: Record<string, Intl.DateTimeFormatOptions> = {
    short: { month: 'numeric', day: 'numeric', year: '2-digit' },
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    long: { month: 'long', day: 'numeric', year: 'numeric' },
    full: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  };
  const options = formatOptions[format];

  return d.toLocaleDateString(locale, options);
}

/**
 * Format time to localized string
 */
export function formatTime(
  date: Date | string,
  includeSeconds: boolean = false,
  locale: string = 'en-US'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
  });
}

/**
 * Truncate text with ellipsis
 */
export function truncate(
  text: string,
  maxLength: number,
  suffix: string = '...'
): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Capitalize first letter
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Convert snake_case or kebab-case to Title Case
 */
export function toTitleCase(text: string): string {
  return text
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Parse number from formatted string
 */
export function parseFormattedNumber(text: string): number | null {
  if (!text) return null;

  // Remove currency symbols, spaces, and commas
  const cleaned = text.replace(/[^\d.-]/g, '');
  const number = parseFloat(cleaned);

  return isNaN(number) ? null : number;
}

/**
 * Clamp number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generate random ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Sleep/delay utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get color class based on value (positive/negative/neutral)
 */
export function getValueColorClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'text-gray-500';
  if (value > 0) return 'text-green-500';
  if (value < 0) return 'text-red-500';
  return 'text-gray-500';
}

/**
 * Get background color class based on value
 */
export function getValueBgClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'bg-gray-500/10';
  if (value > 0) return 'bg-green-500/10';
  if (value < 0) return 'bg-red-500/10';
  return 'bg-gray-500/10';
}

/**
 * Safe divide (returns 0 if denominator is 0)
 */
export function safeDivide(
  numerator: number,
  denominator: number,
  fallback: number = 0
): number {
  if (denominator === 0) return fallback;
  return numerator / denominator;
}

/**
 * Calculate percentage change
 */
export function percentageChange(
  oldValue: number,
  newValue: number
): number | null {
  if (oldValue === 0) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
