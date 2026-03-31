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

export function formatTimestamp(
  date: Date | string | number | null | undefined
): string {
  if (date === null || date === undefined) return '-';

  return formatAbsoluteTimestamp(date);
}

export function formatRelativeTime(
  date: Date | string | number | null | undefined
): string {
  const parsed = parseFlexibleDate(date);
  if (!parsed) return '-';

  const diffMs = Date.now() - parsed.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatAbsoluteTimestamp(parsed);
}

export function parseFlexibleDate(
  value: Date | string | number | null | undefined
): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const now = new Date();
  if (['just now', 'vua xong', 'vừa xong', 'moi dang', 'mới đăng'].includes(lower)) {
    return now;
  }

  const relativeMatch = lower.match(/^(\d+)\s*(phut|phút|min|minute|minutes|gio|giờ|hour|hours|ngay|ngày|day|days)\s*(truoc|trước|ago)$/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const parsed = new Date(now);

    if (['phut', 'phút', 'min', 'minute', 'minutes'].includes(unit)) {
      parsed.setMinutes(parsed.getMinutes() - amount);
      return parsed;
    }
    if (['gio', 'giờ', 'hour', 'hours'].includes(unit)) {
      parsed.setHours(parsed.getHours() - amount);
      return parsed;
    }
    if (['ngay', 'ngày', 'day', 'days'].includes(unit)) {
      parsed.setDate(parsed.getDate() - amount);
      return parsed;
    }
  }

  if (lower === 'yesterday' || lower === 'hom qua' || lower === 'hôm qua') {
    const parsed = new Date(now);
    parsed.setDate(parsed.getDate() - 1);
    return parsed;
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const parsed = new Date(
      Number(compact[1]),
      Number(compact[2]) - 1,
      Number(compact[3])
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dmy = raw.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const parsed = new Date(
      year,
      Number(dmy[2]) - 1,
      Number(dmy[1]),
      Number(dmy[4] ?? 0),
      Number(dmy[5] ?? 0),
      Number(dmy[6] ?? 0)
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = raw.replace(/\//g, '-');
  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function formatAbsoluteTimestamp(
  date: Date | string | number | null | undefined
): string {
  if (date === null || date === undefined) return '-'

  const parsed = parseFlexibleDate(date)
  if (!parsed) return '-'
  if (Number.isNaN(parsed.getTime())) return '-'

  const yyyy = parsed.getFullYear()
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  const hh = String(parsed.getHours()).padStart(2, '0')
  const min = String(parsed.getMinutes()).padStart(2, '0')

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

/**
 * Format date to localized string
 */
export function formatDate(
  date: Date | string,
  _format: 'short' | 'medium' | 'long' | 'full' = 'medium',
  _locale: string = 'en-US'
): string {
  return formatTimestamp(date);
}

/**
 * Format time to localized string
 */
export function formatTime(
  date: Date | string,
  includeSeconds: boolean = false,
  locale: string = 'en-US'
): string {
  const d = parseFlexibleDate(date);
  if (!d) return '-';

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
