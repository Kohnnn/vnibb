// Dividend Payment Widget - Company Calendar tab

'use client';



interface DividendData {
    date: string;
    adjustedDividend: number;
    dividend: number;
    recordDate: string;
    paymentDate: string;
    declarationDate: string;
}

interface DividendPaymentWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock data for demonstration
const mockDividendData: DividendData[] = [
    { date: '2024-11-08', adjustedDividend: 0.25, dividend: 0.25, recordDate: '2024-11-11', paymentDate: '2024-11-14', declarationDate: '2024-10-31' },
    { date: '2024-08-12', adjustedDividend: 0.25, dividend: 0.25, recordDate: '2024-08-12', paymentDate: '2024-08-15', declarationDate: '2024-08-01' },
    { date: '2024-05-10', adjustedDividend: 0.25, dividend: 0.25, recordDate: '2024-05-13', paymentDate: '2024-05-16', declarationDate: '2024-05-02' },
    { date: '2024-02-09', adjustedDividend: 0.24, dividend: 0.24, recordDate: '2024-02-12', paymentDate: '2024-02-15', declarationDate: '2024-02-01' },
    { date: '2023-11-10', adjustedDividend: 0.24, dividend: 0.24, recordDate: '2023-11-13', paymentDate: '2023-11-16', declarationDate: '2023-11-02' },
];

export function DividendPaymentWidget({ symbol, isEditing, onRemove }: DividendPaymentWidgetProps) {
    return (
        <>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase">
                            <th className="pb-2 pr-3">Date</th>
                            <th className="pb-2 pr-3 text-right">Adj. Dividend</th>
                            <th className="pb-2 pr-3 text-right">Dividend</th>
                            <th className="pb-2 pr-3">Record Date</th>
                            <th className="pb-2 pr-3">Payment Date</th>
                            <th className="pb-2">Declaration</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mockDividendData.map((row, idx) => (
                            <tr key={idx} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-2 pr-3 text-gray-300">{row.date}</td>
                                <td className="py-2 pr-3 text-right text-green-400">{row.adjustedDividend.toFixed(2)}</td>
                                <td className="py-2 pr-3 text-right text-white">{row.dividend.toFixed(2)}</td>
                                <td className="py-2 pr-3 text-gray-400">{row.recordDate}</td>
                                <td className="py-2 pr-3 text-gray-400">{row.paymentDate}</td>
                                <td className="py-2 text-gray-400">{row.declarationDate}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-800/50 text-xs text-gray-500">
                Current Currency: VND
            </div>
        </>
    );
}
