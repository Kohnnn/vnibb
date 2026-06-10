import {
  listRuns,
  saveRun,
  togglePin,
  deleteRun,
  clearUnpinned,
  runsToRows,
  QUANT_RUN_HISTORY_KEY,
} from '@/lib/quantRunHistory'

describe('quantRunHistory', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function makeRun(name: string, widget: 'edge_half_life' | 'pair_lab' = 'edge_half_life') {
    return saveRun({
      widget,
      name,
      config: { symbol: 'FPT', window: 63 },
      summary: { current: 1.2, peak: 2.0 },
    })
  }

  it('saves and lists runs newest-first', () => {
    makeRun('run A')
    makeRun('run B')
    const runs = listRuns()
    expect(runs).toHaveLength(2)
    expect(runs[0].name).toBe('run B')
    expect(runs[1].name).toBe('run A')
  })

  it('filters by widget', () => {
    makeRun('edge run', 'edge_half_life')
    makeRun('pair run', 'pair_lab')
    expect(listRuns('pair_lab')).toHaveLength(1)
    expect(listRuns('pair_lab')[0].name).toBe('pair run')
  })

  it('toggles pin state', () => {
    const run = makeRun('pin me')
    expect(run.pinned).toBe(false)
    togglePin(run.id)
    expect(listRuns()[0].pinned).toBe(true)
    togglePin(run.id)
    expect(listRuns()[0].pinned).toBe(false)
  })

  it('deletes a run', () => {
    const run = makeRun('delete me')
    makeRun('keep me')
    deleteRun(run.id)
    const runs = listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].name).toBe('keep me')
  })

  it('clearUnpinned removes only unpinned runs', () => {
    const pinned = makeRun('pinned')
    makeRun('unpinned A')
    makeRun('unpinned B')
    togglePin(pinned.id)
    clearUnpinned()
    const runs = listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].name).toBe('pinned')
  })

  it('clearUnpinned scoped to a widget leaves other widgets intact', () => {
    makeRun('edge run', 'edge_half_life')
    makeRun('pair run', 'pair_lab')
    clearUnpinned('edge_half_life')
    const runs = listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].widget).toBe('pair_lab')
  })

  it('enforces the 50-run budget, pruning oldest unpinned first', () => {
    for (let i = 0; i < 60; i += 1) makeRun(`run ${i}`)
    const runs = listRuns()
    expect(runs.length).toBeLessThanOrEqual(50)
    // newest survive
    expect(runs[0].name).toBe('run 59')
  })

  it('keeps pinned runs even beyond the budget', () => {
    const pinned = makeRun('keep forever')
    togglePin(pinned.id)
    for (let i = 0; i < 60; i += 1) makeRun(`run ${i}`)
    const runs = listRuns()
    expect(runs.length).toBeLessThanOrEqual(50)
    expect(runs.some((run) => run.name === 'keep forever')).toBe(true)
  })

  it('survives a corrupt storage payload', () => {
    window.localStorage.setItem(QUANT_RUN_HISTORY_KEY, 'not json{')
    expect(listRuns()).toEqual([])
    expect(() => makeRun('after corruption')).not.toThrow()
    expect(listRuns()).toHaveLength(1)
  })

  it('runsToRows flattens config and summary with prefixes', () => {
    makeRun('row run')
    const rows = runsToRows(listRuns())
    expect(rows[0]).toMatchObject({
      widget: 'edge_half_life',
      name: 'row run',
      'summary.current': 1.2,
      'config.symbol': 'FPT',
      'config.window': 63,
    })
  })
})
