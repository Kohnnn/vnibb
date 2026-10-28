'use client';

import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Search, Download, RefreshCw } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAPI } from '@/lib/api';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';

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

async function fetchDatabaseStats(): Promise<DatabaseStats> {
  const data = await fetchAPI<{ tables: TableData[]; last_checked?: string }>('/admin/database/stats', { auth: 'required' });
  const tables = data.tables;
  const totalRecords = tables.reduce((sum, table) => sum + table.count, 0);
  return {
    tables,
    total_records: totalRecords,
    database_status: totalRecords > 0 ? 'healthy' : 'warning',
    last_sync: data.last_checked,
  };
}

async function fetchTableSample(table: string, limit = 500): Promise<{ rows: Record<string, unknown>[] }> {
  return fetchAPI(`/admin/database/sample/${encodeURIComponent(table)}`, {
    auth: 'required',
    params: { limit },
  });
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

function DatabaseInspectorWidgetComponent({ onRemove, lastRefresh, onDataChange }: { onRemove?: () => void, lastRefresh?: number, onDataChange?: (data: WidgetDataPayload) => void }) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { user, isAdmin, adminStatus } = useAuth();
  const queryClient = useQueryClient();
  const operatorId = isAdmin ? user?.id : null;
  useEffect(() => {
    if (operatorId) return;
    setSelectedTable(null);
    queryClient.removeQueries({ queryKey: ['adminDatabase'] });
  }, [operatorId, queryClient]);

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['adminDatabase', operatorId, 'stats'],
    queryFn: fetchDatabaseStats,
    enabled: Boolean(operatorId),
    staleTime: 30000,
  });

  const { data: sampleData, isLoading: sampleLoading, error: sampleError } = useQuery({
    queryKey: ['adminDatabase', operatorId, 'sample', selectedTable],
    queryFn: () => fetchTableSample(selectedTable!, 500),
    enabled: Boolean(operatorId && selectedTable),
  });

  useEffect(() => {
    if (lastRefresh && operatorId) {
        refetch();
    }
  }, [lastRefresh, operatorId, refetch]);

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
            <span className="text-[var(--text-secondary)] font-mono text-[10px]">
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

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !operatorId || !hasTables,
      apiGroup: '/admin',
      endpoint: selectedTable ? `/api/v1/admin/database/sample/${selectedTable}` : '/api/v1/admin/database/stats',
      sourceLabel: 'VNIBB admin database inspector',
      lastDataDate: null,
      fetchedAt: operatorId ? dataUpdatedAt || stats?.last_sync || null : null,
      extra: { tables: operatorId ? stats?.tables?.length ?? 0 : 0, selected: operatorId ? selectedTable : null },
    }))
  }, [dataUpdatedAt, hasTables, onDataChange, operatorId, selectedTable, stats?.last_sync, stats?.tables?.length]);

  return (
    <WidgetContainer
      title="Data Browser"
      onRefresh={() => { if (operatorId) void refetch(); }}
      onClose={onRemove}
      noPadding
      isLoading={Boolean(operatorId && statsLoading && !hasTables)}
    >
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-3 pt-2">
          <WidgetMeta
            updatedAt={null}
            fetchedAt={operatorId ? dataUpdatedAt || stats?.last_sync || null : null}
            isFetching={Boolean(operatorId && isFetching && hasTables)}
            isCached={Boolean(operatorId && statsError && hasTables)}
            note={stats?.last_sync ? `Admin stats · Last sync ${stats.last_sync}` : 'Admin stats'}
            align="right"
          />
        </div>
        {/* Table List */}
        <div className="p-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] flex flex-wrap gap-1">
          {!operatorId ? (
            <WidgetError
              title={adminStatus === 'checking' ? 'Checking admin access' : 'Admin access required'}
              error={new Error(adminStatus === 'checking' ? 'Verifying your operator session.' : 'Sign in with an authorized operator account.')}
            />
          ) : statsLoading && !hasTables ? (
            <WidgetSkeleton lines={3} />
          ) : statsError ? (
            <WidgetError error={statsError as Error} onRetry={() => refetch()} />
          ) : !hasTables ? (
            <WidgetEmpty message="No tables found" />
          ) : (
            stats?.tables?.map((table: TableData) => (
              <button
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                className={`px-2 py-1 text-[10px] font-bold rounded transition-all uppercase ${
                  selectedTable === table.name
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
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
                <div className="flex items-center gap-2 p-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                    <div className="relative flex-1">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                            type="text"
                            placeholder={`Search in ${selectedTable}...`}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-7 pr-2 py-1 text-[10px] bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <button
                        onClick={handleExport}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                        title="Export CSV"
                    >
                        <Download size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden bg-[var(--bg-primary)]">
                    {sampleLoading ? (
                        <div className="p-10 flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
                             <RefreshCw size={24} className="animate-spin" />
                             <span className="text-[10px] font-bold uppercase tracking-widest">Fetching data...</span>
                        </div>
                    ) : sampleError ? (
                        <WidgetError error={sampleError as Error} onRetry={() => void queryClient.invalidateQueries({ queryKey: ['adminDatabase', operatorId, 'sample', selectedTable] })} />
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
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-2 opacity-50">
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
