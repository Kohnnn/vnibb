// Earnings History Widget - Company Calendar tab

'use client';



interface EarningsData {
    date: string;
    eps: number | null;
    epsEst: number | null;
    revenue: number | null;
    revenueEst: number | null;
    transcript?: string;
}

interface EarningsHistoryWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock data for demonstration
const mockEarningsData: EarningsData[] = [
    { date: '2024-10-31', eps: 1.64, epsEst: 1.60, revenue: 94500, revenueEst: 94100, transcript: 'View transcript' },
    { date: '2024-07-25', eps: 1.40, epsEst: 1.35, revenue: 85800, revenueEst: 84400 },
    { date: '2024-05-02', eps: 1.53, epsEst: 1.50, revenue: 90800, revenueEst: 90300 },
    { date: '2024-02-01', eps: 2.18, epsEst: 2.10, revenue: 119600, revenueEst: 118000 },
    { date: '2023-11-02', eps: 1.46, epsEst: 1.39, revenue: 89500, revenueEst: 89200 },
    { date: '2023-08-03', eps: 1.26, epsEst: 1.19, revenue: 81800, revenueEst: 81530 },
];

function formatEps(value: number | null): string {
    if (value === null) return '-';
    return value.toFixed(2);
}

function formatRevenue(value: number | null): string {
    if (value === null) return '-';
    return `${(value / 1000).toFixed(1)}B`;
}

function getEpsBeatMiss(eps: number | null, epsEst: number | null): { text: string; color: string } {
    if (eps === null || epsEst === null) return { text: '-', color: 'text-gray-500' };
    const diff = eps - epsEst;
    if (diff > 0) return { text: `+${diff.toFixed(2)}`, color: 'text-green-400' };
    if (diff < 0) return { text: diff.toFixed(2), color: 'text-red-400' };
    return { text: '0.00', color: 'text-gray-400' };
}

export function EarningsHistoryWidget({ symbol, isEditing, onRemove }: EarningsHistoryWidgetProps) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4 text-right">EPS</th>
                        <th className="pb-2 pr-4 text-right">EPS Est.</th>
                        <th className="pb-2 pr-4 text-right">Beat/Miss</th>
                        <th className="pb-2 pr-4 text-right">Revenue</th>
                        <th className="pb-2 pr-4 text-right">Rev Est.</th>
                        <th className="pb-2">Transcript</th>
                    </tr>
                </thead>
                <tbody>
                    {mockEarningsData.map((row, idx) => {
                        const beatMiss = getEpsBeatMiss(row.eps, row.epsEst);
                        return (
                            <tr key={idx} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-2 pr-4 text-gray-300">{row.date}</td>
                                <td className="py-2 pr-4 text-right text-white font-medium">{formatEps(row.eps)}</td>
                                <td className="py-2 pr-4 text-right text-gray-400">{formatEps(row.epsEst)}</td>
                                <td className={`py-2 pr-4 text-right ${beatMiss.color}`}>{beatMiss.text}</td>
                                <td className="py-2 pr-4 text-right text-white">{formatRevenue(row.revenue)}</td>
                                <td className="py-2 pr-4 text-right text-gray-400">{formatRevenue(row.revenueEst)}</td>
                                <td className="py-2">
                                    {row.transcript && (
                                        <button className="text-blue-400 hover:text-blue-300 text-xs">
                                            View transcript
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
