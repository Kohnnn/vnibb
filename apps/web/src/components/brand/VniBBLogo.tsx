import { cn } from '@/lib/utils';

/**
 * VniBB master wordmark on its white plate.
 *
 * The artwork is `public/brand/vnibb-wordmark-master.svg`, a byte-identical copy
 * of the brand pack master (2048 × 446). It is rendered unchanged: no recolor,
 * crop or typed replacement. Dark surroundings get the white plate; light
 * surfaces use the same plate so the field stays white everywhere.
 *
 * Plate padding is the brand clear space X = 0.055 × wordmark width on every
 * side (VniBB_BRAND.md §10). Width is `width` CSS px (must stay ≥ 80 px for the
 * visible wordmark); height follows the native ratio.
 */

export const VNIBB_WORDMARK_RATIO = 2048 / 446;
export const VNIBB_LOGO_CLEAR_SPACE = 0.055;

export const VNIBB_BRAND_NAME = 'VniBB';
export const VNIBB_BRAND_DESCRIPTOR = 'Research cockpit for Vietnamese equities';
/** Public site and source repository, used by email/social channel artwork. */
export const VNIBB_CANONICAL_URL = 'https://web.vnibb.xyz';
export const VNIBB_REPOSITORY_URL = 'https://github.com/Kohnnn/vnibb';
/** Absolute wordmark URL for channels that cannot resolve page-relative paths. */
export const VNIBB_WORDMARK_URL = `${VNIBB_CANONICAL_URL}/brand/vnibb-wordmark-master.svg`;

/** Plate size for a wordmark of `width` px: wordmark + 2X on each axis. */
export function getLogoPlateSize(width: number) {
  const clearSpace = width * VNIBB_LOGO_CLEAR_SPACE;
  const height = width / VNIBB_WORDMARK_RATIO;
  return {
    clearSpace,
    plateWidth: width + clearSpace * 2,
    plateHeight: height + clearSpace * 2,
  };
}

interface VniBBLogoProps {
  /** Visible wordmark width in CSS px. Minimum 80. */
  width?: number;
  className?: string;
  /** Accessible name; pass `null` when an adjacent link already names the brand. */
  label?: string | null;
}

export function VniBBLogo({ width = 112, className, label = VNIBB_BRAND_NAME }: VniBBLogoProps) {
  const { clearSpace, plateWidth, plateHeight } = getLogoPlateSize(width);

  return (
    <span
      className={cn('vnibb-logo-plate', className)}
      style={{
        display: 'inline-flex',
        width: plateWidth,
        height: plateHeight,
        padding: clearSpace,
        backgroundColor: '#ffffff',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      <img
        src="/brand/vnibb-wordmark-master.svg"
        alt={label ?? ''}
        aria-hidden={label ? undefined : true}
        width={2048}
        height={446}
        style={{ width, height: plateHeight - clearSpace * 2, display: 'block' }}
      />
    </span>
  );
}
