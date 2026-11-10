import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'

import { VNIBB_BRAND_NAME, VniBBLogo } from '@/components/brand/VniBBLogo'

describe('VniBBLogo', () => {
  it('names the logo unless an adjacent label already does', () => {
    const { rerender } = render(<VniBBLogo />)
    expect(screen.getByRole('img', { name: VNIBB_BRAND_NAME })).toBeInTheDocument()

    rerender(<VniBBLogo label={null} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('README wordmark on a dark host', () => {
  // GitHub renders README badges and images on either theme. The master is pure
  // black on a transparent field, so on the dark theme it is black on black.
  // The plate variant exists for that host; the app keeps using the master.
  const readme = readFileSync(join(process.cwd(), '..', '..', 'README.md'), 'utf8');
  const plate = readFileSync(join(process.cwd(), 'public', 'brand', 'vnibb-wordmark-plate.svg'), 'utf8');
  const master = readFileSync(join(process.cwd(), 'public', 'brand', 'vnibb-wordmark-master.svg'), 'utf8');

  it('points the README at the plated wordmark, not the transparent master', () => {
    expect(readme).toContain('vnibb-wordmark-plate.svg');
    expect(readme).not.toContain('vnibb-wordmark-master.svg');
  });

  it('gives the plate an opaque white field the master does not have', () => {
    expect(master).not.toMatch(/<rect[^>]*fill="#FFFFFF"/i);
    expect(plate).toMatch(/<rect[^>]*fill="#FFFFFF"/i);
  });

  it('keeps the master artwork unchanged inside the plate', () => {
    // The plate may only add a field and an offset; every path must survive.
    const paths = (svg: string) => svg.match(/<path\b/g)?.length ?? 0;
    expect(paths(plate)).toBe(paths(master));
    for (const colour of master.match(/fill="#[0-9a-fA-F]{6}"/g) ?? []) {
      expect(plate).toContain(colour);
    }
  });
});

describe('app icon (brand §207)', () => {
  const icon = readFileSync(join(process.cwd(), 'src', 'app', 'icon.svg'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'manifest.json'), 'utf8'))
  const master = readFileSync(join(process.cwd(), 'public', 'brand', 'vnibb-wordmark-master.svg'), 'utf8')

  it('uses the unchanged wordmark on the white plate, not an invented symbol', () => {
    const paths = (svg: string) => svg.match(/<path\b/g)?.length ?? 0
    expect(paths(icon)).toBe(paths(master))
    expect(icon).toMatch(/<rect[^>]*fill="#FFFFFF"/i)
  })

  it('stays opaque: an icon with a transparent field disappears on a dark tab bar', () => {
    expect(icon).not.toMatch(/fill="(?:none|transparent)"/i)
  })

  it('is declared in the web manifest so an installed app has an icon', () => {
    expect(manifest.icons?.map((entry: { src: string }) => entry.src)).toContain('/icon.svg')
  })

  // SVG icons are ignored by iOS home screens and some install surfaces, which
  // need a raster. Both PNGs are rendered from the same icon.svg, so their
  // dimensions and opaque field are the contract worth pinning.
  it.each([
    ['src/app/apple-icon.png', 180],
    ['public/brand/icon-512.png', 512],
  ])('ships %s at %ipx with an opaque field', (file, size) => {
    const png = readFileSync(join(process.cwd(), file))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
  })

  it('declares the raster icon too, for install surfaces that reject SVG', () => {
    expect(manifest.icons?.map((entry: { src: string }) => entry.src)).toContain('/brand/icon-512.png')
  })
})
