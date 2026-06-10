'use client'

/**
 * Cross-sectional robustness checks for the Signal Robustness Lab.
 *
 * The lab operates on a screener *snapshot* (cross-section), not per-symbol time
 * series, so these are cross-sectional robustness diagnostics — NOT a temporal
 * backtest, walk-forward, or PBO. Descriptive only.
 *
 * - Fold stability: split the universe into K contiguous slices and check
 *   whether the pass-vs-universe forward-return edge keeps the same sign.
 * - Null benchmark: a permutation test — randomly relabel the same number of
 *   "passing" symbols many times and see where the real edge sits in the
 *   shuffled-edge distribution.
 */

import { makeRng } from '@/lib/quantLabMath'

export interface UniversePoint {
  /** Whether the symbol passes the chosen signal threshold. */
  pass: boolean
  /** Forward (trailing, realized) return used as the edge read, in %. */
  forward: number
}

export interface FoldEdge {
  fold: number
  size: number
  passCount: number
  edge: number | null
}

export interface FoldStability {
  folds: FoldEdge[]
  /** Count of folds whose edge has the same sign as the overall edge. */
  signAgreement: number
  /** Number of folds that had both passing and non-passing members. */
  evaluableFolds: number
  overallEdge: number | null
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function edgeOf(points: UniversePoint[]): number | null {
  const passVals = points.filter((p) => p.pass).map((p) => p.forward)
  const allVals = points.map((p) => p.forward)
  const passAvg = mean(passVals)
  const allAvg = mean(allVals)
  if (passAvg === null || allAvg === null) return null
  return passAvg - allAvg
}

/** Split the universe into K contiguous slices and measure edge-sign agreement. */
export function computeFoldStability(universe: UniversePoint[], k = 4): FoldStability {
  const overallEdge = edgeOf(universe)
  const empty: FoldStability = { folds: [], signAgreement: 0, evaluableFolds: 0, overallEdge }
  if (universe.length < k * 5) return empty

  const folds: FoldEdge[] = []
  const sliceSize = Math.floor(universe.length / k)
  let signAgreement = 0
  let evaluableFolds = 0
  for (let i = 0; i < k; i += 1) {
    const start = i * sliceSize
    const end = i === k - 1 ? universe.length : start + sliceSize
    const slice = universe.slice(start, end)
    const passCount = slice.filter((p) => p.pass).length
    const edge = passCount > 0 && passCount < slice.length ? edgeOf(slice) : null
    folds.push({ fold: i + 1, size: slice.length, passCount, edge })
    if (edge !== null) {
      evaluableFolds += 1
      if (overallEdge !== null && Math.sign(edge) === Math.sign(overallEdge) && overallEdge !== 0) {
        signAgreement += 1
      }
    }
  }
  return { folds, signAgreement, evaluableFolds, overallEdge }
}

export interface NullBenchmark {
  realEdge: number | null
  /** Percentile (0-100) of the real edge within the shuffled-edge distribution. */
  percentile: number | null
  iterations: number
  passCount: number
  universeSize: number
}

/**
 * Permutation null: randomly relabel `passCount` symbols as passing, recompute the
 * edge, repeat `iterations` times, and report where the real edge lands as a
 * percentile of the shuffled distribution. Seeded for reproducibility.
 */
export function computeNullBenchmark(
  universe: UniversePoint[],
  options?: { iterations?: number; seed?: number },
): NullBenchmark {
  const iterations = options?.iterations ?? 200
  const passCount = universe.filter((p) => p.pass).length
  const universeSize = universe.length
  const base: NullBenchmark = {
    realEdge: edgeOf(universe),
    percentile: null,
    iterations,
    passCount,
    universeSize,
  }
  if (universeSize < 10 || passCount === 0 || passCount >= universeSize || base.realEdge === null) {
    return base
  }

  const forwards = universe.map((p) => p.forward)
  const universeMean = mean(forwards) ?? 0
  const rng = makeRng(options?.seed ?? 1337)

  // Fisher-Yates partial shuffle: pick `passCount` indices, average their forward
  // returns, subtract the universe mean. Edge = passMean - universeMean.
  const indices = forwards.map((_, i) => i)
  const shuffledEdges: number[] = []
  for (let iter = 0; iter < iterations; iter += 1) {
    let sum = 0
    for (let i = 0; i < passCount; i += 1) {
      const j = i + Math.floor(rng() * (indices.length - i))
      const tmp = indices[i]
      indices[i] = indices[j]
      indices[j] = tmp
      sum += forwards[indices[i]]
    }
    shuffledEdges.push(sum / passCount - universeMean)
  }

  const below = shuffledEdges.filter((e) => e <= (base.realEdge as number)).length
  return { ...base, percentile: (below / shuffledEdges.length) * 100 }
}
