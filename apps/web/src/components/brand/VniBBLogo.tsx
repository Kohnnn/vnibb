import { cn } from '@/lib/utils';
import styles from './VniBBLogo.module.css';

/** The master wordmark keeps its native ratio and 5.5% clear space on each side. */
const VNIBB_WORDMARK_RATIO = 2048 / 446;
const VNIBB_LOGO_CLEAR_SPACE = 0.055;

export const VNIBB_BRAND_NAME = 'VniBB';
export const VNIBB_BRAND_DESCRIPTOR = 'Research cockpit for Vietnamese equities';
/** Public site and source repository, used by email/social channel artwork. */
export const VNIBB_CANONICAL_URL = 'https://web.vnibb.xyz';
export const VNIBB_REPOSITORY_URL = 'https://github.com/Kohnnn/vnibb';
/** Absolute wordmark URL for channels that cannot resolve page-relative paths. */
export const VNIBB_WORDMARK_URL = `${VNIBB_CANONICAL_URL}/brand/vnibb-wordmark-master.svg`;

interface VniBBLogoProps {
  /** Visible wordmark width in CSS px. Minimum 80. */
  width?: number;
  className?: string;
  /** Accessible name; pass `null` when an adjacent link already names the brand. */
  label?: string | null;
}

export function VniBBLogo({ width = 112, className, label = VNIBB_BRAND_NAME }: VniBBLogoProps) {
  const wordmarkWidth = Math.max(width, 80);
  const wordmarkHeight = wordmarkWidth / VNIBB_WORDMARK_RATIO;
  const clearSpace = wordmarkWidth * VNIBB_LOGO_CLEAR_SPACE;

  return (
    <span
      className={cn(styles.logo, className)}
      data-brand-wordmark
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{
        width: wordmarkWidth + clearSpace * 2,
        height: wordmarkHeight + clearSpace * 2,
        padding: clearSpace,
      }}
    >
      <span className={styles.wordmark} style={{ width: wordmarkWidth, height: wordmarkHeight }} />
    </span>
  );
}
