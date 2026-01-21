// Financial Statements Widget - Income Statement, Balance Sheet, Cash Flow
'use client';

import { useState, useEffect } from 'react';
import { FileText, TrendingUp, TrendingDown, RefreshCw, ChevronDown } from 'lucide-react';
import { ExportButton } from '@/components/common/ExportButton';
import { exportFinancials } from '@/lib/api';

type StatementType = 'income' | 'balance' | 'cashflow';
type Period = 'annual' | 'quarterly';

interface FinancialStatementsWidgetProps {
    symbol?: string;
    isEditing?: boolean;
}

// Mock data structure
interface FinancialRow {
    label: string;
    values: number[];
    isHeader?: boolean;
    indent?: number;
}

const PERIODS = ['2023', '2022', '2021', '2020'];

const MOCK_INCOME_STATEMENT: FinancialRow[] = [
    { label: 'Revenue', values: [125000, 115000, 105000, 95000], isHeader: true },
    { label: 'Cost of Revenue', values: [75000, 70000, 65000, 60000], indent: 1 },
    { label: 'Gross Profit', values: [50000, 45000, 40000, 35000], isHeader: true },
    { label: 'Operating Expenses', values: [25000, 22000, 20000, 18000], indent: 1 },
    { label: 'Operating Income', values: [25000, 23000, 20000, 17000], isHeader: true },
    { label: 'Interest Expense', values: [2000, 2500, 3000, 3500], indent: 1 },
    { label: 'Net Income', values: [18000, 16000, 13000, 10000], isHeader: true },
];

const MOCK_BALANCE_SHEET: FinancialRow[] = [
    { label: 'Total Assets', values: [500000, 450000, 400000, 350000], isHeader: true },
    { label: 'Current Assets', values: [150000, 130000, 110000, 95000], indent: 1 },
    { label: 'Non-Current Assets', values: [350000, 320000, 290000, 255000], indent: 1 },
    { label: 'Total Liabilities', values: [200000, 180000, 160000, 140000], isHeader: true },
    { label: 'Current Liabilities', values: [80000, 70000, 60000, 50000], indent: 1 },
    { label: 'Long-term Debt', values: [120000, 110000, 100000, 90000], indent: 1 },
    { label: 'Total Equity', values: [300000, 270000, 240000, 210000], isHeader: true },
];

const MOCK_CASHFLOW: FinancialRow[] = [
    { label: 'Operating Cash Flow', values: [30000, 28000, 25000, 22000], isHeader: true },
    { label: 'Depreciation', values: [5000, 4500, 4000, 3500], indent: 1 },
    { label: 'Changes in Working Capital', values: [-2000, -1500, -1000, -500], indent: 1 },
    { label: 'Investing Cash Flow', values: [-15000, -12000, -10000, -8000], isHeader: true },
    { label: 'Capital Expenditures', values: [-10000, -8000, -7000, -6000], indent: 1 },
    { label: 'Acquisitions', values: [-5000, -4000, -3000, -2000], indent: 1 },
    { label: 'Financing Cash Flow', values: [-8000, -10000, -8000, -6000], isHeader: true },
    { label: 'Dividends Paid', values: [-5000, -4500, -4000, -3500], indent: 1 },
    { label: 'Net Cash Flow', values: [7000, 6000, 7000, 8000], isHeader: true },
];

export function FinancialStatementsWidget({ symbol = 'VNM', isEditing }: FinancialStatementsWidgetProps) {
    const [statementType, setStatementType] = useState<StatementType>('income');
    const [period, setPeriod] = useState<Period>('annual');
    const [isLoading, setIsLoading] = useState(false);

    const getData = () => {
        switch (statementType) {
            case 'income': return MOCK_INCOME_STATEMENT;
            case 'balance': return MOCK_BALANCE_SHEET;
            case 'cashflow': return MOCK_CASHFLOW;
        }
    };

    const formatNumber = (num: number) => {
        if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
        if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
        if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
        return num.toLocaleString();
    };

    const getYoYChange = (current: number, previous: number) => {
        if (previous === 0) return 0;
        return ((current - previous) / Math.abs(previous)) * 100;
    };

    const data = getData();

    return (
        <div className="h-full flex flex-col bg-[#0b1221]">
            {/* Tabs & Controls */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b]">
                <div className="flex items-center gap-1">
                    {(['income', 'balance', 'cashflow'] as StatementType[]).map((type) => (
                        <button
                            key={type}
                            onClick={() => setStatementType(type)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${statementType === type
                                ? 'bg-blue-600/20 text-blue-400'
                                : 'text-gray-400 hover:text-white hover:bg-[#1e293b]'
                                }`}
                        >
                            {type === 'income' ? 'Income' : type === 'balance' ? 'Balance' : 'Cash Flow'}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value as Period)}
                        className="bg-[#1e293b] border border-[#334155] rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
                    >
                        <option value="annual">Annual</option>
                        <option value="quarterly">Quarterly</option>
                    </select>
                    <ExportButton
                        onExport={async (format) => {
                            await exportFinancials(symbol, {
                                type: statementType,
                                period: period === 'annual' ? 'year' : 'quarter',
                                format
                            });
                        }}
                    />
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#0f172a]">
                        <tr className="text-gray-500">
                            <th className="text-left px-3 py-2 font-medium min-w-[140px]">Item</th>
                            {PERIODS.map((p) => (
                                <th key={p} className="text-right px-3 py-2 font-medium min-w-[80px]">{p}</th>
                            ))}
                            <th className="text-right px-3 py-2 font-medium min-w-[60px]">YoY %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, index) => {
                            const yoyChange = getYoYChange(row.values[0], row.values[1]);
                            return (
                                <tr
                                    key={index}
                                    className={`border-b border-[#1e293b]/30 hover:bg-[#1e293b]/20 ${row.isHeader ? 'bg-[#1e293b]/10' : ''
                                        }`}
                                >
                                    <td
                                        className={`px-3 py-2 ${row.isHeader ? 'font-semibold text-white' : 'text-gray-300'}`}
                                        style={{ paddingLeft: row.indent ? `${12 + row.indent * 16}px` : '12px' }}
                                    >
                                        {row.label}
                                    </td>
                                    {row.values.map((val, i) => (
                                        <td
                                            key={i}
                                            className={`text-right px-3 py-2 font-mono ${val < 0 ? 'text-red-400' : row.isHeader ? 'text-white' : 'text-gray-300'
                                                }`}
                                        >
                                            {formatNumber(val)}
                                        </td>
                                    ))}
                                    <td className={`text-right px-3 py-2 font-mono ${yoyChange > 0 ? 'text-green-400' : yoyChange < 0 ? 'text-red-400' : 'text-gray-400'
                                        }`}>
                                        {yoyChange > 0 ? '+' : ''}{yoyChange.toFixed(1)}%
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-[#1e293b] text-[10px] text-gray-500">
                All values in VND millions. Data for {symbol}.
            </div>
        </div>
    );
}
