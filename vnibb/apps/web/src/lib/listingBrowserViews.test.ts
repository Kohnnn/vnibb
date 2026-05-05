import {
  buildListingBrowserFilterSummary,
  buildListingBrowserViewName,
  readListingBrowserViews,
  removeListingBrowserView,
  saveListingBrowserView,
} from '@/lib/listingBrowserViews'

describe('listingBrowserViews', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('saves and reads listing browser views', () => {
    const views = saveListingBrowserView({
      id: 'ALL:VN30:ALL::symbol',
      name: 'ALL • VN30',
      exchange: 'ALL',
      group: 'VN30',
      industry: 'ALL',
      search: '',
      sortMode: 'industry',
      updatedAt: '2026-04-17T10:00:00.000Z',
    })

    expect(views).toHaveLength(1)
    expect(readListingBrowserViews()[0]).toEqual(expect.objectContaining({ name: 'ALL • VN30', sortMode: 'industry' }))
  })

  test('builds descriptive saved view names', () => {
    expect(buildListingBrowserViewName({
      exchange: 'HOSE',
      group: 'VN30',
      industry: 'Banks',
      search: 'vcb',
      sortMode: 'industry',
    })).toBe('HOSE • VN30 • Banks • Search: vcb • Sort: industry')
  })

  test('builds filter summaries for active discovery filters', () => {
    expect(buildListingBrowserFilterSummary({
      exchange: 'ALL',
      group: 'ALL',
      industry: 'Technology',
      search: 'fpt',
      sortMode: 'company',
    })).toBe('Showing all exchanges, all groups, Technology, matching "fpt". Sorted by company.')
  })

  test('removes saved views', () => {
    saveListingBrowserView({
      id: 'view-1',
      name: 'HOSE',
      exchange: 'HOSE',
      group: 'ALL',
      industry: 'ALL',
      search: 'bank',
      updatedAt: '2026-04-17T10:00:00.000Z',
    })

    const next = removeListingBrowserView('view-1')
    expect(next).toEqual([])
  })
})
