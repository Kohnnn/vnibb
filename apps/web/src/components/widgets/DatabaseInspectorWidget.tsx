'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Search, Download, RefreshCw } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { env } from '@/lib/env';

interface TableData {
  name: string;
  count: number;
  last_updated?: string;
}

interface DatabaseStats {
    tables: TableData[];
    total_records: number;
    database_status: 'healthy' | 'warning' | 'error';
    last_sync?: string;
}

const API_URL = env.apiUrl;

async function fetchDatabaseStats(): Promise<DatabaseStats> {
    try {
        const response = await fetch(`${API_URL}/api/v1/admin/database/stats`);
        if (!response.ok) throw new Error('Admin stats endpoint failed');

        const data = await response.json();
        const tables = Object.entries(data.tables || {}).map(([name, info]: [string, any]) => ({
            name,
            count: info.count || 0,
            last_updated: info.last_updated
        }));

        const totalRecords = tables.reduce((sum, t) => sum + t.count, 0);

        return {
            tables,
            total_records: totalRecords,
            database_status: totalRecords > 0 ? 'healthy' : 'warning',
            last_sync: data.last_checked
        };
    } catch (error) {
        return {
            tables: [],
            total_records: 0,
            database_status: 'error',
        };
    }
}

async function fetchTableSample(table: string, limit = 500) {
  const res = await fetch(`${API_URL}/api/v1/admin/database/sample/${table}?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch sample');
  return res.json();
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'boolean') return val ? 'YES' : 'NO';
  if (typeof val === 'string' && val.includes('T') && val.length > 10) {
      try {
          return new Date(val).toLocaleDateString();
      } catch { return val; }
  }
  return String(val);
}

function convertToCSV(rows: any[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(','),
    ...rows.map(row => headers.map(h => {
        const cell = row[h];
        return JSON.stringify(cell === null ? '' : cell);
    }).join(','))
  ];
  return csvRows.join('\n');
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DatabaseInspectorWidgetComponent({ onRemove, lastRefresh }: { onRemove?: () => void, lastRefresh?: number }) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['databaseStats'],
    queryFn: fetchDatabaseStats,
    staleTime: 30000,
  });

  const { data: sampleData, isLoading: sampleLoading } = useQuery({
    queryKey: ['tableSample', selectedTable],
    queryFn: () => fetchTableSample(selectedTable!, 500),
    enabled: !!selectedTable,
  });

  useEffect(() => {
    if (lastRefresh) {
        refetch();
    }
  }, [lastRefresh, refetch]);

  const rows = useMemo(() => {
    if (!sampleData?.rows) return [];
    return sampleData.rows.filter((row: any) =>
        searchTerm === '' ||
        Object.values(row).some(v => 
            String(v).toLowerCase().includes(searchTerm.toLowerCase())
        )
    );
  }, [sampleData, searchTerm]);

  const columns = useMemo((): VirtualizedColumn<any>[] => {
    if (!rows.length || !sampleData?.rows?.[0]) return [];
    return Object.keys(sampleData.rows[0]).map(key => ({
        id: key,
        header: key,
        accessor: (row) => (
            <span className="text-gray-400 font-mono text-[10px]">
                {formatValue(row[key])}
            </span>
        ),
        width: 120
    }));
  }, [rows, sampleData]);

  const handleExport = () => {
    if (!rows.length) return;
    const csv = convertToCSV(rows);
    downloadCSV(csv, `${selectedTable}_export.csv`);
  };

  const hasTables = Boolean(stats?.tables?.length);

  return (
    <WidgetContainer
      title="Data Browser"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={statsLoading && !hasTables}
      noPadding
    >
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-3 pt-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasTables}
            isCached={Boolean(statsError && hasTables)}
            note="Admin stats"
            align="right"
          />
        </div>
        {/* Table List */}
        <div className="p-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] flex flex-wrap gap-1">
          {statsLoading && !hasTables ? (
            <WidgetSkeleton lines={3} />
          ) : statsError && !hasTables ? (
            <WidgetError error={statsError as Error} onRetry={() => refetch()} />
          ) : !hasTables ? (
            <WidgetEmpty message="No tables found or backend offline" />
          ) : (
            stats?.tables?.map((table: TableData) => (
              <button
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                className={`px-2 py-1 text-[10px] font-bold rounded transition-all uppercase ${
                  selectedTable === table.name
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700'
                }`}
              >
                {table.name} ({table.count})
              </button>
            ))
          )}
        </div>

        {/* Selected Table View */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedTable ? (
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Search & Actions */}
                <div className="flex items-center gap-2 p-2 bg-gray-900/30 border-b border-gray-800">
                    <div className="relative flex-1">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            placeholder={`Search in ${selectedTable}...`}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-7 pr-2 py-1 text-[10px] bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <button
                        onClick={handleExport}
                        className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        title="Export CSV"
                    >
                        <Download size={14} />
                    </button>
                </div>

                {/* Data Table */}
                <div className="flex-1 overflow-hidden bg-black">
                    {sampleLoading ? (
                        <div className="p-10 flex flex-col items-center justify-center text-gray-600 gap-2">
                             <RefreshCw size={24} className="animate-spin" />
                             <span className="text-[10px] font-bold uppercase tracking-widest">Fetching data...</span>
                        </div>
                    ) : rows.length === 0 ? (
                         <WidgetEmpty message="No rows match your filter" />
                    ) : (
                        <VirtualizedTable
                            data={rows}
                            columns={columns}
                            rowHeight={30}
                        />
                    )}
                </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-2 opacity-50">
                <Database size={48} strokeWidth={1} />
                <p className="text-xs uppercase font-bold tracking-widest">Select a table to browse data</p>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const DatabaseInspectorWidget = memo(DatabaseInspectorWidgetComponent);
export default DatabaseInspectorWidget;
