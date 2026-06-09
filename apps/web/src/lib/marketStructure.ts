'use client'

/**
 * Volume-by-price profile + value area + key levels for the VN Market Structure
 * widget. Pure client-side computation over EOD bars already fetched from
 * `/equity/historical`. Used as a self-contained fallback and to derive key
 * levels even when the backend microstructure profile is unavailable.
 */

export interface ProfileBar {
  high: number
  low: number
  close: number
  volume?: number | null
}

export interface ProfileBin {
  price: number
  volume: number
  inValueArea: boolean
  isPoc: boolean
}

export interface VolumeProfileResult {
  bins: ProfileBin[]
  poc: number | null
  vah: number | null
  val: number | null
  totalVolume: number
  maxBinVolume: number
  // Key high-volume levels (the strongest nodes), sorted by volume desc.
  keyLevels: Array<{ price: number; volume: number; volumePct: number }>
}

/**
 * Build a volume profile. Value area is the contiguous band around the POC that
 * accumulates `valueAreaPct` of total volume (standard market-profile method).
 */
export function buildVolumeProfile(
  bars: ProfileBar[],
  numBins = 24,
  valueAreaPct = 0.7,
): VolumeProfileResult | null {
  const clean = bars.filter(
    (b) => Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= b.low && b.high > 0,
  )
  if (clean.length < 3) return null

  let minPrice = Infinity
  let maxPrice = -Infinity
  for (const bar of clean) {
    if (bar.low < minPrice) minPrice = bar.low
    if (bar.high > maxPrice) maxPrice = bar.high
  }
  const range = maxPrice - minPrice
  if (range <= 0) return null

  const binSize = range / numBins
  const raw: Array<{ price: number; volume: number }> = []
  for (let i = 0; i < numBins; i += 1) {
    raw.push({ price: minPrice + (i + 0.5) * binSize, volume: 0 })
  }

  let totalVolume = 0
  for (const bar of clean) {
    const volume = Number(bar.volume) || 0
    const mid = (bar.high + bar.low) / 2
    const idx = Math.min(Math.floor((mid - minPrice) / binSize), numBins - 1)
    if (idx >= 0 && idx < numBins) {
      raw[idx].volume += volume
      totalVolume += volume
    }
  }

  if (totalVolume <= 0) return null

  // POC = highest-volume bin
  let pocIndex = 0
  for (let i = 1; i < raw.length; i += 1) {
    if (raw[i].volume > raw[pocIndex].volume) pocIndex = i
  }

  // Value area: expand outward from POC until valueAreaPct of volume is covered.
  const targetVolume = totalVolume * valueAreaPct
  let lo = pocIndex
  let hi = pocIndex
  let accumulated = raw[pocIndex].volume
  while (accumulated < targetVolume && (lo > 0 || hi < raw.length - 1)) {
    const loCandidate = lo > 0 ? raw[lo - 1].volume : -1
    const hiCandidate = hi < raw.length - 1 ? raw[hi + 1].volume : -1
    if (hiCandidate >= loCandidate) {
      hi += 1
      accumulated += raw[hi].volume
    } else {
      lo -= 1
      accumulated += raw[lo].volume
    }
  }

  const val = raw[lo].price
  const vah = raw[hi].price
  const poc = raw[pocIndex].price
  const maxBinVolume = raw[pocIndex].volume

  const bins: ProfileBin[] = raw.map((bin, i) => ({
    price: bin.price,
    volume: bin.volume,
    inValueArea: i >= lo && i <= hi,
    isPoc: i === pocIndex,
  }))

  const keyLevels = [...raw]
    .map((bin) => ({ price: bin.price, volume: bin.volume, volumePct: (bin.volume / totalVolume) * 100 }))
    .filter((level) => level.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5)

  return { bins, poc, vah, val, totalVolume, maxBinVolume, keyLevels }
}
