import { useCallback } from 'react';

export function useDataExport() {
  const downloadFile = useCallback((content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportToCSV = useCallback((data: any[], filename: string) => {
    if (!data || data.length === 0) return;
    
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => 
        headers.map(h => {
          const val = row[h];
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? '';
        }).join(',')
      )
    ].join('\n');
    
    downloadFile(csv, `${filename}.csv`, 'text/csv');
  }, [downloadFile]);

  const exportToJSON = useCallback((data: any, filename: string) => {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${filename}.json`, 'application/json');
  }, [downloadFile]);

  return { exportToCSV, exportToJSON };
}
