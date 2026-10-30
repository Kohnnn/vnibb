import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { useComparison } from './useComparison';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('@/lib/api', () => ({ API_BASE_URL: '/api' }));

const mockQuery = useQuery as jest.Mock;
const mockGet = axios.get as jest.Mock;

it('forwards provenance and excludes unverified and conflicting market caps from normalized averages', async () => {
  const certified = { status: 'available', value: 57.3, source: 'certified', unit: 'VND', currency: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 57.3, source: 'certified' }] };
  mockGet.mockResolvedValue({ data: {
    metrics: [{ id: 'market_cap', name: 'Market Cap', format: 'currency' }],
    data: {
      VCI: { metrics: { market_cap: 22410910941.25, pe: 10 } },
      FPT: { metrics: { market_cap: 57.3, pe: 20 }, market_cap_provenance: certified },
      VNM: { metrics: { market_cap: 500, pe: 30 }, market_cap_provenance: { ...certified, status: 'conflict', value: null, reason: 'disagreement' } },
    },
    sectorAverages: { market_cap: 22410910941.25 },
    sector_averages: { market_cap: 22410910941.25, pe: 13 },
  } });
  useComparison(['VCI', 'FPT', 'VNM']);
  const response = await mockQuery.mock.calls.at(-1)![0].queryFn();
  expect(response.data.VCI.metrics.market_cap).toBeNull();
  expect(response.data.VCI.market_cap_result.inputs[0].value).toBe(22410910941.25);
  expect(response.data.VNM.metrics.market_cap).toBeNull();
  expect(response.data.FPT.market_cap_provenance).toEqual(certified);
  expect(response.sectorAverages.market_cap).toBe(57.3);
  expect(response.sector_averages).toEqual({ pe: 13 });
  expect(response.sectorAverages.pe).toBe(20);
});
