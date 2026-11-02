import { render, screen } from '@testing-library/react'

import {
  VNIBB_BRAND_DESCRIPTOR,
  VNIBB_BRAND_NAME,
  VNIBB_LOGO_CLEAR_SPACE,
  VNIBB_WORDMARK_RATIO,
  VniBBLogo,
  getLogoPlateSize,
} from '@/components/brand/VniBBLogo'

describe('VniBBLogo', () => {
  it('renders the byte-identical master wordmark on a white plate', () => {
    render(<VniBBLogo width={112} />)
    const image = screen.getByRole('img', { name: VNIBB_BRAND_NAME })
    expect(image).toHaveAttribute('src', '/brand/vnibb-wordmark-master.svg')
    const plate = image.parentElement as HTMLElement
    expect(plate).toHaveClass('vnibb-logo-plate')
    expect(plate.style.backgroundColor).toBe('rgb(255, 255, 255)')
  })

  it('derives the plate from the native 2048:446 ratio with 5.5% clear space', () => {
    const { clearSpace, plateWidth, plateHeight } = getLogoPlateSize(112)
    expect(VNIBB_WORDMARK_RATIO).toBeCloseTo(2048 / 446, 6)
    expect(VNIBB_LOGO_CLEAR_SPACE).toBe(0.055)
    expect(clearSpace).toBeCloseTo(6.16, 5)
    expect(plateWidth).toBeCloseTo(124.32, 5)
    expect(plateHeight).toBeCloseTo(112 / (2048 / 446) + 6.16 * 2, 5)
  })

  it('keeps the visible wordmark at or above the 80px screen minimum', () => {
    render(<VniBBLogo width={80} />)
    const image = screen.getByRole('img', { name: VNIBB_BRAND_NAME })
    expect(Number.parseFloat(image.style.width)).toBeGreaterThanOrEqual(80)
  })

  it('exposes the approved name and descriptor copy', () => {
    expect(VNIBB_BRAND_NAME).toBe('VniBB')
    expect(VNIBB_BRAND_DESCRIPTOR).toBe('Research cockpit for Vietnamese equities')
  })
})
