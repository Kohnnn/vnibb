import {
  computeFoldStability,
  computeNullBenchmark,
  type UniversePoint,
} from '@/lib/signalRobustness'

function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('computeFoldStability', () => {
  it('returns empty for a tiny universe', () => {
    const result = computeFoldStability([{ pass: true, forward: 1 }], 4)
    expect(result.folds).toEqual([])
    expect(result.evaluableFolds).toBe(0)
  })

  it('reports high sign agreement when the edge is consistent across folds', () => {
    // Passing symbols always outperform within every slice.
    const universe: UniversePoint[] = []
    for (let i = 0; i < 80; i += 1) {
      universe.push({ pass: true, forward: 10 })
      universe.push({ pass: false, forward: 0 })
    }
    const result = computeFoldStability(universe, 4)
    expect(result.folds).toHaveLength(4)
    expect(result.overallEdge).not.toBeNull()
    expect(result.overallEdge! > 0).toBe(true)
    expect(result.evaluableFolds).toBe(4)
    expect(result.signAgreement).toBe(4)
  })

  it('marks folds without both classes as non-evaluable', () => {
    // First half all-pass, second half all-fail -> each slice is single-class.
    const universe: UniversePoint[] = []
    for (let i = 0; i < 40; i += 1) universe.push({ pass: true, forward: 5 })
    for (let i = 0; i < 40; i += 1) universe.push({ pass: false, forward: 1 })
    const result = computeFoldStability(universe, 4)
    // Middle folds are single-class -> null edge.
    expect(result.evaluableFolds).toBeLessThan(4)
  })
})

describe('computeNullBenchmark', () => {
  it('returns null percentile when no symbols pass', () => {
    const universe: UniversePoint[] = Array.from({ length: 50 }, () => ({ pass: false, forward: 1 }))
    const result = computeNullBenchmark(universe)
    expect(result.percentile).toBeNull()
    expect(result.passCount).toBe(0)
  })

  it('places a strong real edge near the top of the null distribution', () => {
    const rng = makeRng(42)
    const universe: UniversePoint[] = []
    // Passing symbols genuinely outperform; null shuffles should rarely beat it.
    for (let i = 0; i < 30; i += 1) universe.push({ pass: true, forward: 20 + rng() * 2 })
    for (let i = 0; i < 70; i += 1) universe.push({ pass: false, forward: rng() * 2 })
    const result = computeNullBenchmark(universe, { iterations: 200, seed: 7 })
    expect(result.realEdge).not.toBeNull()
    expect(result.percentile).not.toBeNull()
    expect(result.percentile!).toBeGreaterThan(95)
  })

  it('is reproducible for a fixed seed', () => {
    const rng = makeRng(3)
    const universe: UniversePoint[] = []
    for (let i = 0; i < 40; i += 1) universe.push({ pass: i % 3 === 0, forward: rng() * 10 })
    const a = computeNullBenchmark(universe, { iterations: 150, seed: 99 })
    const b = computeNullBenchmark(universe, { iterations: 150, seed: 99 })
    expect(a.percentile).toBe(b.percentile)
  })

  it('places a no-edge selection near the middle of the null distribution', () => {
    const rng = makeRng(5)
    // Pass flag uncorrelated with forward returns -> real edge should be unremarkable.
    const universe: UniversePoint[] = Array.from({ length: 200 }, () => ({
      pass: rng() < 0.3,
      forward: rng() * 10,
    }))
    const result = computeNullBenchmark(universe, { iterations: 300, seed: 11 })
    expect(result.percentile).not.toBeNull()
    expect(result.percentile!).toBeGreaterThan(10)
    expect(result.percentile!).toBeLessThan(90)
  })
})
