// Stock Splits Widget - Company Calendar tab

'use client';



interface StockSplitData {
    executionDate: string;
    splitFrom: number;
    splitTo: number;
}

interface StockSplitsWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock data for demonstration
const mockSplitData: StockSplitData[] = [
    { executionDate: '2020-08-31', splitFrom: 1, splitTo: 4 },
    { executionDate: '2014-06-09', splitFrom: 1, splitTo: 7 },
    { executionDate: '2005-02-28', splitFrom: 1, splitTo: 2 },
    { executionDate: '2000-06-21', splitFrom: 1, splitTo: 2 },
];

export function StockSplitsWidget({ symbol, isEditing, onRemove }: StockSplitsWidgetProps) {
    return (
        <>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase">
                            <th className="pb-2 pr-4">Execution Date</th>
                            <th className="pb-2 pr-4 text-center">Split From</th>
                            <th className="pb-2 text-center">Split To</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mockSplitData.map((row, idx) => (
                            <tr key={idx} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-2 pr-4 text-gray-300">{row.executionDate}</td>
                                <td className="py-2 pr-4 text-center text-blue-400 font-medium">{row.splitFrom}</td>
                                <td className="py-2 text-center text-green-400 font-medium">{row.splitTo}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {mockSplitData.length === 0 && (
                <div className="text-center text-gray-500 py-4">
                    No stock splits recorded
                </div>
            )}
        </>
    );
}
